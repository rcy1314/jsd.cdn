export type ConvertKind = 'gh' | 'npm' | 'jsdelivr'

export type ConvertOk = {
  supported: true
  input: string
  kind: ConvertKind
  jsdelivrUrl: string
  stable: boolean
}

export type ConvertFail = {
  supported: false
  input: string
  reason: string
}

export type ConvertResult = ConvertOk | ConvertFail

const JSDELIVR_HOSTS = new Set(['cdn.jsdelivr.net', 'fastly.jsdelivr.net'])

const isProbablyCommitSha = (ref: string) => /^[0-9a-f]{7,40}$/i.test(ref)
const isProbablySemver = (ref: string) =>
  /^v?\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(ref)

const isStableRef = (ref: string) => {
  const lower = ref.toLowerCase()
  if (lower === 'main' || lower === 'master' || lower === 'head' || lower === 'latest') return false
  return isProbablySemver(ref) || isProbablyCommitSha(ref)
}

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

const parseNpmSpec = (spec: string) => {
  const s = spec.trim()
  if (!s) return null

  let pkgAndVer = ''
  let path = ''

  if (s.startsWith('@')) {
    const firstSlash = s.indexOf('/')
    if (firstSlash < 0) return null
    const secondSlash = s.indexOf('/', firstSlash + 1)
    if (secondSlash < 0) return null
    pkgAndVer = s.slice(0, secondSlash)
    path = s.slice(secondSlash + 1)
  } else {
    const slash = s.indexOf('/')
    if (slash < 0) return null
    pkgAndVer = s.slice(0, slash)
    path = s.slice(slash + 1)
  }

  if (!path) return null

  const at = pkgAndVer.lastIndexOf('@')
  if (at > 0) {
    return {
      pkg: pkgAndVer.slice(0, at),
      ver: pkgAndVer.slice(at + 1) || 'latest',
      path
    }
  }

  return { pkg: pkgAndVer, ver: 'latest', path }
}

export const convertToJsDelivr = (rawInput: string): ConvertResult => {
  const input = safeDecode(String(rawInput ?? '')).trim()
  if (!input) return { supported: false, input: '', reason: '缺少 url 参数' }

  const shorthandGh = /^gh:([^/]+)\/([^@/]+)(?:@([^/]+))?\/(.+)$/.exec(input)
  if (shorthandGh) {
    const owner = shorthandGh[1]
    const repo = shorthandGh[2]
    const ref = shorthandGh[3] || 'main'
    const path = shorthandGh[4]
    return {
      supported: true,
      input,
      kind: 'gh',
      jsdelivrUrl: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`,
      stable: isStableRef(ref)
    }
  }

  if (input.startsWith('npm:')) {
    const parsed = parseNpmSpec(input.slice(4))
    if (!parsed) return { supported: false, input, reason: 'npm: 简写格式不正确（示例：npm:pkg@ver/dist/x.js）' }
    return {
      supported: true,
      input,
      kind: 'npm',
      jsdelivrUrl: `https://cdn.jsdelivr.net/npm/${parsed.pkg}@${parsed.ver}/${parsed.path}`,
      stable: parsed.ver !== 'latest' && isStableRef(parsed.ver)
    }
  }

  try {
    const u = new URL(input)

    if (JSDELIVR_HOSTS.has(u.hostname)) {
      if (u.pathname.startsWith('/gh/') || u.pathname.startsWith('/npm/')) {
        const isStable = /\/gh\/[^/]+\/[^@/]+@([^/]+)\//.exec(u.pathname)?.[1]
        const npmStable = /\/npm\/[^/]+@([^/]+)\//.exec(u.pathname)?.[1]
        const ref = isStable || npmStable
        return {
          supported: true,
          input,
          kind: 'jsdelivr',
          jsdelivrUrl: u.toString(),
          stable: ref ? isStableRef(ref) : false
        }
      }
      return { supported: false, input, reason: '仅支持 jsDelivr 的 /gh/ 或 /npm/ 路径' }
    }

    if (u.hostname === 'raw.githubusercontent.com') {
      const m = /^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(u.pathname)
      if (!m) return { supported: false, input, reason: '无法识别 raw.githubusercontent.com 链接结构' }
      const [, owner, repo, ref, path] = m
      return {
        supported: true,
        input,
        kind: 'gh',
        jsdelivrUrl: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`,
        stable: isStableRef(ref)
      }
    }

    if (u.hostname === 'github.com') {
      const m = /^\/([^/]+)\/([^/]+)\/(blob|raw)\/([^/]+)\/(.+)$/.exec(u.pathname)
      if (m) {
        const [, owner, repo, , ref, path] = m
        return {
          supported: true,
          input,
          kind: 'gh',
          jsdelivrUrl: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${path}`,
          stable: isStableRef(ref)
        }
      }
      if (/^\/[^/]+\/[^/]+\/releases\/download\//.test(u.pathname)) {
        return { supported: false, input, reason: 'GitHub Releases 资源不支持直接转换为 jsDelivr（请改用仓库文件链接）' }
      }
    }

    if (u.hostname === 'unpkg.com') {
      const parsed = parseNpmSpec(u.pathname.replace(/^\/+/, ''))
      if (!parsed) return { supported: false, input, reason: '无法识别 unpkg 链接结构' }
      return {
        supported: true,
        input,
        kind: 'npm',
        jsdelivrUrl: `https://cdn.jsdelivr.net/npm/${parsed.pkg}@${parsed.ver}/${parsed.path}`,
        stable: parsed.ver !== 'latest' && isStableRef(parsed.ver)
      }
    }

    return { supported: false, input, reason: '暂不支持该域名/链接格式（支持 GitHub raw/blob、unpkg、jsDelivr、gh:/npm:）' }
  } catch {
    return { supported: false, input, reason: '不是合法 URL（或缺少协议），可尝试使用 gh: / npm: 简写' }
  }
}
