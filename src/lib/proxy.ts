import type { Context } from 'hono'

const ALLOWED_HOSTS = new Set(['cdn.jsdelivr.net', 'fastly.jsdelivr.net'])

const parseEnvList = (v: string | undefined) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const readBool = (v: string | undefined) => {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return false
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

const readInt = (v: string | undefined, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const UPSTREAM_HOSTS = (() => {
  const a = parseEnvList(process.env.JSD_UPSTREAM_HOSTS)
  const b = parseEnvList(process.env.JSDELIVR_UPSTREAM_HOSTS)
  const raw = a.length ? a : b.length ? b : []
  const picked = raw.length ? raw : ['cdn.jsdelivr.net', 'fastly.jsdelivr.net']
  return picked.filter((h) => ALLOWED_HOSTS.has(h))
})()

const ENABLE_EXTERNAL_FALLBACK = readBool(process.env.JSD_PROXY_FALLBACK_EXTERNAL)
const FETCH_TIMEOUT_MS = readInt(process.env.JSD_PROXY_FETCH_TIMEOUT_MS, 12000)
const FETCH_RETRIES = readInt(process.env.JSD_PROXY_FETCH_RETRIES, 2)
const FETCH_RETRY_BASE_DELAY_MS = readInt(process.env.JSD_PROXY_FETCH_RETRY_BASE_DELAY_MS, 250)
const FETCH_RETRY_MAX_DELAY_MS = readInt(process.env.JSD_PROXY_FETCH_RETRY_MAX_DELAY_MS, 2000)

const pickCacheControl = (stable: boolean) => {
  if (stable) return 'public, max-age=31536000, immutable'
  return 'public, max-age=3600'
}

const copyHeaderIfPresent = (from: Headers, to: Headers, key: string) => {
  const v = from.get(key)
  if (v) to.set(key, v)
}

const trackStreamBytes = (body: ReadableStream<Uint8Array>) => {
  let total = 0
  let resolved = false
  let resolve: (n: number) => void = () => {}
  const done = new Promise<number>((r) => {
    resolve = r
  })
  const finalize = () => {
    if (resolved) return
    resolved = true
    resolve(total)
  }
  const reader = body.getReader()
  const tracked = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const r = await reader.read()
        if (r.done) {
          finalize()
          controller.close()
          return
        }
        const chunk = r.value
        if (chunk) {
          total += chunk.byteLength || 0
          controller.enqueue(chunk)
        }
      } catch (e) {
        finalize()
        controller.error(e)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } catch {}
      finalize()
    }
  })
  return { body: tracked, done: done.catch(() => total) }
}

const isRetryableStatus = (status: number) => status === 429 || status === 502 || status === 503 || status === 504

const getErrCode = (e: unknown) => {
  const any = e as any
  return String(any?.cause?.code || any?.code || any?.cause?.errno || any?.errno || '')
}

const isRetryableError = (e: unknown) => {
  const any = e as any
  const code = getErrCode(e)
  if (any?.name === 'AbortError') return true
  if (code === 'EAI_AGAIN') return true
  if (code === 'ENOTFOUND') return true
  if (code === 'ECONNRESET') return true
  if (code === 'ETIMEDOUT') return true
  if (code === 'EPIPE') return true
  if (code === 'UND_ERR_CONNECT_TIMEOUT') return true
  if (code === 'UND_ERR_HEADERS_TIMEOUT') return true
  if (code === 'UND_ERR_BODY_TIMEOUT') return true
  if (code === 'UND_ERR_SOCKET') return true
  return false
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const calcBackoffMs = (attempt: number) => {
  const raw = Math.min(FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt, FETCH_RETRY_MAX_DELAY_MS)
  const jitter = Math.floor(Math.random() * Math.min(150, Math.max(1, raw / 3)))
  return raw + jitter
}

const tryBuildExternalFallbackUrl = (u: URL) => {
  if (!ENABLE_EXTERNAL_FALLBACK) return ''
  if (u.pathname.startsWith('/npm/')) {
    return `https://unpkg.com/${u.pathname.replace(/^\/npm\//, '')}${u.search}`
  }
  const m = /^\/gh\/([^/]+)\/([^@/]+)@([^/]+)\/(.+)$/.exec(u.pathname)
  if (m) {
    const [, owner, repo, ref, path] = m
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}${u.search}`
  }
  return ''
}

const buildCandidateUrls = (u: URL) => {
  const urls: string[] = []
  const base = u.toString()
  urls.push(base)
  for (const host of UPSTREAM_HOSTS) {
    if (!host || host === u.hostname) continue
    const nu = new URL(base)
    nu.hostname = host
    urls.push(nu.toString())
  }
  const ext = tryBuildExternalFallbackUrl(u)
  if (ext) urls.push(ext)
  return [...new Set(urls)]
}

const fetchWithRetry = async (url: string, accept: string) => {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const r = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { accept }
      })
      if (attempt < FETCH_RETRIES && isRetryableStatus(r.status)) {
        try {
          await r.arrayBuffer()
        } catch {}
        await sleep(calcBackoffMs(attempt))
        continue
      }
      return r
    } catch (e) {
      lastErr = e
      if (attempt >= FETCH_RETRIES || !isRetryableError(e)) throw e
      await sleep(calcBackoffMs(attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastErr
}

export const proxyJsDelivr = async (c: Context, targetUrl: string, stable: boolean) => {
  const u = new URL(targetUrl)
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    return c.json({ error: 'forbidden_host', message: '仅允许代理 jsDelivr 官方域名' }, 403)
  }

  const accept = c.req.header('accept') ?? '*/*'
  const candidates = buildCandidateUrls(u)
  let upstream: Response | null = null
  let usedUrl = ''
  const errors: Array<{ url: string; code: string }> = []

  for (const url of candidates) {
    try {
      upstream = await fetchWithRetry(url, accept)
      usedUrl = url
      break
    } catch (e) {
      errors.push({ url, code: getErrCode(e) })
    }
  }

  if (!upstream) {
    const headers = new Headers()
    headers.set('cache-control', 'no-store')
    headers.set('access-control-allow-origin', '*')
    headers.set('access-control-expose-headers', 'cache-control')
    headers.set('cross-origin-resource-policy', 'cross-origin')
    const last = errors[errors.length - 1]
    return new Response(
      JSON.stringify(
        {
          error: 'upstream_fetch_failed',
          message: '上游网络异常（DNS/出站网络不可用或临时抖动）',
          code: last?.code || '',
          tried: errors.length
        },
        null,
        2
      ),
      { status: 502, headers }
    )
  }

  const headers = new Headers()
  copyHeaderIfPresent(upstream.headers, headers, 'content-type')
  copyHeaderIfPresent(upstream.headers, headers, 'content-length')
  copyHeaderIfPresent(upstream.headers, headers, 'etag')
  copyHeaderIfPresent(upstream.headers, headers, 'last-modified')
  copyHeaderIfPresent(upstream.headers, headers, 'content-encoding')

  headers.set('cache-control', pickCacheControl(stable))
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-expose-headers', 'content-type, content-length, etag, last-modified, cache-control')
  headers.set('cross-origin-resource-policy', 'cross-origin')
  headers.set('x-upstream-url', usedUrl || u.toString())
  try {
    headers.set('x-upstream-host', new URL(usedUrl || u.toString()).hostname)
  } catch {}

  const hasLen = !!headers.get('content-length')
  if (!hasLen && upstream.body) {
    const tracked = trackStreamBytes(upstream.body as ReadableStream<Uint8Array>)
    const res = new Response(tracked.body, { status: upstream.status, headers })
    ;(res as any).__jsd_measuredBytes = tracked.done
    return res
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}
