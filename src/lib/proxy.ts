import type { Context } from 'hono'

const ALLOWED_HOSTS = new Set(['cdn.jsdelivr.net', 'fastly.jsdelivr.net'])

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

export const proxyJsDelivr = async (c: Context, targetUrl: string, stable: boolean) => {
  const u = new URL(targetUrl)
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    return c.json({ error: 'forbidden_host', message: '仅允许代理 jsDelivr 官方域名' }, 403)
  }

  const upstream = await fetch(u.toString(), {
    redirect: 'follow',
    headers: {
      accept: c.req.header('accept') ?? '*/*'
    }
  })

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
  headers.set('x-upstream-url', u.toString())

  const hasLen = !!headers.get('content-length')
  if (!hasLen && upstream.body) {
    const tracked = trackStreamBytes(upstream.body as ReadableStream<Uint8Array>)
    const res = new Response(tracked.body, { status: upstream.status, headers })
    ;(res as any).__jsd_measuredBytes = tracked.done
    return res
  }

  return new Response(upstream.body, { status: upstream.status, headers })
}
