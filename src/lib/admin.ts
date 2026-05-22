export type BanType = 'ip' | 'domain'

export type BanEntry = {
  type: BanType
  value: string
  reason?: string
  createdAt: number
  createdBy: 'manual' | 'auto'
  expiresAt?: number
}

export type Announcement = {
  id: string
  text: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type SecuritySettings = {
  enabled: boolean
  banSeconds: number
  rate: { enabled: boolean; windowSeconds: number; maxRequests: number }
  scan: { enabled: boolean; windowSeconds: number; maxHits: number }
  refererAbuse: { enabled: boolean; windowSeconds: number; maxRequests: number }
  registrationEnabled: boolean
  cleanup: { enabled: boolean; eventRetentionDays: number; topRetentionDays: number }
  traffic: { enabled: boolean; retentionDays: number }
}

export type ContentFormat = 'text' | 'html' | 'md'

export type SiteSettings = {
  footerText: string
  footerFormat: ContentFormat
  title: string
  description: string
  announcementFormat: ContentFormat
  faviconUrl: string
  logoUrl: string
  faviconDataUrl?: string
  logoDataUrl?: string
}

export type PersistedState = {
  version: 1
  settings: SecuritySettings
  site: SiteSettings
  bans: BanEntry[]
  announcements: Announcement[]
}

export type SecurityEvent = {
  id?: number
  ts: number
  kind: 'blocked' | 'auto_ban' | 'manual_ban' | 'unban' | 'announcement_update' | 'settings_update' | 'login_fail'
  ip?: string
  domain?: string
  path?: string
  detail?: string
}

type IpWindowStat = {
  windowStart: number
  requests: number
  scanHits: number
}

type DomainWindowStat = {
  windowStart: number
  requests: number
}

type TrafficBucketStat = {
  bucketStart: number
  bytes: number
  requests: number
}

type IpTrafficStat = {
  ip: string
  bucketStart: number
  bytes: number
  requests: number
}

type DomainTrafficStat = {
  domain: string
  bucketStart: number
  bytes: number
  requests: number
}

const DEFAULT_SETTINGS: SecuritySettings = {
  enabled: true,
  banSeconds: 3600,
  rate: { enabled: true, windowSeconds: 60, maxRequests: 240 },
  scan: { enabled: true, windowSeconds: 60, maxHits: 8 },
  refererAbuse: { enabled: true, windowSeconds: 60, maxRequests: 180 },
  registrationEnabled: false,
  cleanup: { enabled: true, eventRetentionDays: 14, topRetentionDays: 7 },
  traffic: { enabled: false, retentionDays: 30 }
}

const DEFAULT_PERSISTED: PersistedState = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  site: {
    footerText: '',
    footerFormat: 'text',
    title: '',
    description: '',
    announcementFormat: 'text',
    faviconUrl: '',
    logoUrl: ''
  },
  bans: [],
  announcements: []
}

const SCAN_PATHS = [
  '/.env',
  '/wp-admin',
  '/wp-login.php',
  '/phpmyadmin',
  '/pma',
  '/administrator',
  '/admin.php',
  '/actuator',
  '/manager/html',
  '/cgi-bin',
  '/.git',
  '/config',
  '/server-status'
]

const now = () => Date.now()

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const normalizeIp = (ip: string) => {
  const s = String(ip ?? '').trim()
  if (!s) return ''
  let cleaned = s.split(',')[0]?.trim() ?? ''
  if (!cleaned) return ''
  cleaned = cleaned.replace(/^"+|"+$/g, '')
  if (cleaned.toLowerCase() === 'unknown') return ''
  if (cleaned.startsWith('[')) {
    const end = cleaned.indexOf(']')
    if (end > 1) cleaned = cleaned.slice(1, end)
  } else {
    const m = cleaned.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
    if (m) cleaned = m[1]
  }
  if (cleaned.startsWith('::ffff:')) return cleaned.slice('::ffff:'.length)
  return cleaned
}

const isLoopbackIp = (ip: string) => {
  const v = normalizeIp(ip).toLowerCase()
  if (!v) return false
  if (v === '::1') return true
  if (v === '0.0.0.0') return true
  if (/^127\./.test(v)) return true
  return false
}

const isLocalDomain = (domain: string) => {
  const d = String(domain ?? '').trim().toLowerCase()
  if (!d) return false
  if (d === 'localhost' || d.endsWith('.localhost')) return true
  return false
}

export const getClientIp = (req: Request) => {
  const h = req.headers
  return (
    normalizeIp(h.get('cf-connecting-ip') ?? '') ||
    normalizeIp(h.get('fly-client-ip') ?? '') ||
    normalizeIp(h.get('x-client-ip') ?? '') ||
    normalizeIp(h.get('x-real-ip') ?? '') ||
    normalizeIp(h.get('x-forwarded-for') ?? '') ||
    (() => {
      const raw = String(h.get('forwarded') ?? '').trim()
      if (!raw) return ''
      const first = raw.split(',')[0]?.trim() ?? ''
      if (!first) return ''
      const parts = first.split(';').map((x) => x.trim()).filter(Boolean)
      for (const p of parts) {
        const idx = p.indexOf('=')
        if (idx <= 0) continue
        const k = p.slice(0, idx).trim().toLowerCase()
        if (k !== 'for') continue
        let v = p.slice(idx + 1).trim()
        v = v.replace(/^"+|"+$/g, '')
        if (!v || v.startsWith('_')) return ''
        return normalizeIp(v)
      }
      return ''
    })()
  )
}

export const getSiteDomain = (req: Request) => {
  const raw = req.headers.get('origin') || req.headers.get('referer') || ''
  if (!raw) return ''
  try {
    return new URL(raw).hostname.toLowerCase()
  } catch {
    return ''
  }
}

const isProbablyDomain = (value: string) => {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return false
  if (v.includes('/') || v.includes(':')) return false
  if (v === 'localhost') return true
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)
}

const isProbablyIp = (value: string) => {
  const v = normalizeIp(value)
  if (!v) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return true
  return /^[0-9a-f:]+$/i.test(v)
}

const randomId = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return base64urlEncode(bytes)
}

const base64urlEncode = (bytes: Uint8Array) => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const base64urlEncodeText = (text: string) => base64urlEncode(new TextEncoder().encode(text))

const base64urlDecodeToBytes = (b64url: string) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const raw = b64 + pad
  if (typeof atob === 'function') {
    const bin = atob(raw)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  }
  return new Uint8Array(Buffer.from(raw, 'base64'))
}

const timingSafeEq = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

const hmacSign = async (secret: string, message: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return base64urlEncode(new Uint8Array(sig))
}

export const createAdminSession = async (secret: string, ttlSeconds: number) => {
  const issuedAt = now()
  const exp = issuedAt + ttlSeconds * 1000
  const nonce = randomId()
  const payload = `${issuedAt}.${exp}.${nonce}`
  const sig = await hmacSign(secret, payload)
  return `${payload}.${sig}`
}

export const verifyAdminSession = async (secret: string, token: string) => {
  const parts = String(token ?? '').split('.')
  if (parts.length !== 4) return false
  const issuedAt = Number(parts[0])
  const exp = Number(parts[1])
  const nonce = parts[2]
  const sig = parts[3]
  if (!Number.isFinite(issuedAt) || !Number.isFinite(exp) || !nonce || !sig) return false
  if (now() > exp) return false
  const payload = `${issuedAt}.${exp}.${nonce}`
  const expected = await hmacSign(secret, payload)
  return timingSafeEq(expected, sig)
}

export const parseCookie = (cookieHeader: string | null) => {
  const out: Record<string, string> = {}
  if (!cookieHeader) return out
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (!k) continue
    out[k] = v
  }
  return out
}

export const buildSetCookie = (opts: {
  name: string
  value: string
  maxAgeSeconds?: number
  path?: string
  httpOnly?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  secure?: boolean
}) => {
  const parts = [`${opts.name}=${opts.value}`]
  parts.push(`Path=${opts.path ?? '/'}`)
  if (typeof opts.maxAgeSeconds === 'number') parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`)
  if (opts.httpOnly ?? true) parts.push('HttpOnly')
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`)
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

const isNodeRuntime = () =>
  typeof process !== 'undefined' && !!(process as any)?.versions?.node && !(process as any)?.env?.NEXT_RUNTIME

const getEnv = (key: string) => {
  try {
    if (typeof process !== 'undefined' && (process as any)?.env?.[key] != null) return String((process as any).env[key])
  } catch {}
  return undefined
}

const readJsonFile = async (path: string) => {
  if (!isNodeRuntime()) return null
  try {
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(path, 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

const writeJsonFile = async (path: string, data: unknown) => {
  if (!isNodeRuntime()) return false
  try {
    const fs = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

const decodeDataUrl = (dataUrl: string) => {
  const raw = String(dataUrl ?? '').trim()
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(raw)
  if (!m) return null
  const mime = m[1]?.trim().toLowerCase() || ''
  const b64 = m[2]?.trim() || ''
  if (!mime || !b64) return null
  try {
    if (typeof atob === 'function') {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { mime, bytes }
    }
    const buf = Buffer.from(b64, 'base64')
    return { mime, bytes: new Uint8Array(buf) }
  } catch {
    return null
  }
}

const normalizePersisted = (raw: any): PersistedState => {
  if (!raw || typeof raw !== 'object') return DEFAULT_PERSISTED
  if (raw.version !== 1) return DEFAULT_PERSISTED
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : DEFAULT_SETTINGS
  const mergedSettings: SecuritySettings = {
    enabled: !!settings.enabled,
    banSeconds: clamp(Number(settings.banSeconds ?? DEFAULT_SETTINGS.banSeconds), 60, 60 * 60 * 24 * 30),
    rate: {
      enabled: !!settings.rate?.enabled,
      windowSeconds: clamp(Number(settings.rate?.windowSeconds ?? DEFAULT_SETTINGS.rate.windowSeconds), 10, 3600),
      maxRequests: clamp(Number(settings.rate?.maxRequests ?? DEFAULT_SETTINGS.rate.maxRequests), 10, 10000)
    },
    scan: {
      enabled: !!settings.scan?.enabled,
      windowSeconds: clamp(Number(settings.scan?.windowSeconds ?? DEFAULT_SETTINGS.scan.windowSeconds), 10, 3600),
      maxHits: clamp(Number(settings.scan?.maxHits ?? DEFAULT_SETTINGS.scan.maxHits), 1, 1000)
    },
    refererAbuse: {
      enabled: !!settings.refererAbuse?.enabled,
      windowSeconds: clamp(
        Number(settings.refererAbuse?.windowSeconds ?? DEFAULT_SETTINGS.refererAbuse.windowSeconds),
        10,
        3600
      ),
      maxRequests: clamp(Number(settings.refererAbuse?.maxRequests ?? DEFAULT_SETTINGS.refererAbuse.maxRequests), 10, 10000)
    },
    registrationEnabled: !!settings.registrationEnabled,
    cleanup: {
      enabled: settings.cleanup?.enabled != null ? !!settings.cleanup.enabled : DEFAULT_SETTINGS.cleanup.enabled,
      eventRetentionDays: clamp(Number(settings.cleanup?.eventRetentionDays ?? DEFAULT_SETTINGS.cleanup.eventRetentionDays), 1, 365),
      topRetentionDays: clamp(Number(settings.cleanup?.topRetentionDays ?? DEFAULT_SETTINGS.cleanup.topRetentionDays), 1, 365)
    },
    traffic: {
      enabled: settings.traffic?.enabled != null ? !!settings.traffic.enabled : DEFAULT_SETTINGS.traffic.enabled,
      retentionDays: clamp(Number(settings.traffic?.retentionDays ?? DEFAULT_SETTINGS.traffic.retentionDays), 1, 365)
    }
  }
  const bans: BanEntry[] = Array.isArray(raw.bans)
    ? raw.bans
        .filter((b: any) => b && (b.type === 'ip' || b.type === 'domain') && typeof b.value === 'string')
        .map((b: any) => ({
          type: b.type,
          value: String(b.value).toLowerCase(),
          reason: typeof b.reason === 'string' ? b.reason : undefined,
          createdAt: Number(b.createdAt) || now(),
          createdBy: b.createdBy === 'auto' ? 'auto' : 'manual',
          expiresAt: b.expiresAt != null ? Number(b.expiresAt) : undefined
        }))
    : []
  const announcements: Announcement[] = Array.isArray(raw.announcements)
    ? raw.announcements
        .filter((a: any) => a && typeof a.id === 'string' && typeof a.text === 'string')
        .map((a: any) => ({
          id: a.id,
          text: String(a.text),
          enabled: !!a.enabled,
          createdAt: Number(a.createdAt) || now(),
          updatedAt: Number(a.updatedAt) || now()
        }))
    : []
  const siteRaw = raw.site && typeof raw.site === 'object' ? raw.site : {}
  const site: SiteSettings = {
    footerText: typeof siteRaw.footerText === 'string' ? siteRaw.footerText : '',
    footerFormat: siteRaw.footerFormat === 'html' || siteRaw.footerFormat === 'md' ? siteRaw.footerFormat : 'text',
    title: typeof siteRaw.title === 'string' ? siteRaw.title : '',
    description: typeof siteRaw.description === 'string' ? siteRaw.description : '',
    announcementFormat:
      siteRaw.announcementFormat === 'html' || siteRaw.announcementFormat === 'md' ? siteRaw.announcementFormat : 'text',
    faviconUrl: typeof siteRaw.faviconUrl === 'string' ? siteRaw.faviconUrl : '',
    logoUrl: typeof siteRaw.logoUrl === 'string' ? siteRaw.logoUrl : '',
    faviconDataUrl: typeof siteRaw.faviconDataUrl === 'string' ? siteRaw.faviconDataUrl : undefined,
    logoDataUrl: typeof siteRaw.logoDataUrl === 'string' ? siteRaw.logoDataUrl : undefined
  }
  return { version: 1, settings: mergedSettings, site, bans, announcements }
}

const getStorePath = () => getEnv('ADMIN_STORE_PATH') || './data/admin.json'

export const isAdminEnabled = () => {
  const pwd = getEnv('ADMIN_PASSWORD')
  return !!pwd && pwd.length >= 8
}

export const getAdminSecret = () => getEnv('ADMIN_SECRET') || getEnv('ADMIN_PASSWORD') || ''

export const getAdminPassword = () => getEnv('ADMIN_PASSWORD') || ''

export class AdminStore {
  private ready = false
  private persisted: PersistedState = DEFAULT_PERSISTED
  private readonly storePath: string
  private events: SecurityEvent[] = []
  private eventSeq = 0
  private ipStats = new Map<string, IpWindowStat>()
  private domainStats = new Map<string, DomainWindowStat>()
  private trafficByHour = new Map<number, TrafficBucketStat>()
  private clientTrafficByHour = new Map<string, IpTrafficStat | DomainTrafficStat>()
  private lastCleanupAt = 0

  constructor(storePath = getStorePath()) {
    this.storePath = storePath
  }

  async init() {
    if (this.ready) return
    const raw = await readJsonFile(this.storePath)
    this.persisted = normalizePersisted(raw)
    this.ready = true
  }

  getPersisted() {
    return this.persisted
  }

  getAnnouncementsPublic() {
    return this.persisted.announcements.filter((a) => a.enabled).map((a) => ({ id: a.id, text: a.text }))
  }

  getSiteSettings(): SiteSettings {
    const s = this.persisted.site
    return {
      footerText: String(s.footerText ?? ''),
      footerFormat: s.footerFormat === 'html' || s.footerFormat === 'md' ? s.footerFormat : 'text',
      title: String(s.title ?? ''),
      description: String(s.description ?? ''),
      announcementFormat: s.announcementFormat === 'html' || s.announcementFormat === 'md' ? s.announcementFormat : 'text',
      faviconUrl: String(s.faviconUrl ?? ''),
      logoUrl: String(s.logoUrl ?? ''),
      faviconDataUrl: typeof s.faviconDataUrl === 'string' ? s.faviconDataUrl : undefined,
      logoDataUrl: typeof s.logoDataUrl === 'string' ? s.logoDataUrl : undefined
    }
  }

  async updateSiteSettings(next: Partial<SiteSettings>) {
    await this.init()
    const cur = this.persisted.site
    const merged: SiteSettings = {
      footerText: next.footerText != null ? String(next.footerText) : String(cur.footerText ?? ''),
      footerFormat: next.footerFormat === 'html' || next.footerFormat === 'md' ? next.footerFormat : cur.footerFormat === 'html' || cur.footerFormat === 'md' ? cur.footerFormat : 'text',
      title: next.title != null ? String(next.title) : String(cur.title ?? ''),
      description: next.description != null ? String(next.description) : String(cur.description ?? ''),
      announcementFormat:
        next.announcementFormat === 'html' || next.announcementFormat === 'md'
          ? next.announcementFormat
          : cur.announcementFormat === 'html' || cur.announcementFormat === 'md'
            ? cur.announcementFormat
            : 'text',
      faviconUrl: next.faviconUrl != null ? String(next.faviconUrl) : String(cur.faviconUrl ?? ''),
      logoUrl: next.logoUrl != null ? String(next.logoUrl) : String(cur.logoUrl ?? ''),
      faviconDataUrl: typeof cur.faviconDataUrl === 'string' ? cur.faviconDataUrl : undefined,
      logoDataUrl: typeof cur.logoDataUrl === 'string' ? cur.logoDataUrl : undefined
    }
    this.persisted.site = merged
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: 'site_settings_update' })
    await this.persist()
    return merged
  }

  getSiteAsset(kind: 'favicon' | 'logo') {
    const dataUrl = kind === 'favicon' ? this.persisted.site.faviconDataUrl : this.persisted.site.logoDataUrl
    if (!dataUrl) return null
    const parsed = decodeDataUrl(dataUrl)
    if (!parsed) return null
    if (!parsed.mime.startsWith('image/')) return null
    return parsed
  }

  async setSiteAsset(kind: 'favicon' | 'logo', dataUrl: string) {
    await this.init()
    const parsed = decodeDataUrl(dataUrl)
    if (!parsed) return { ok: false as const, error: 'invalid_data_url' as const }
    if (!parsed.mime.startsWith('image/')) return { ok: false as const, error: 'invalid_mime' as const }
    if (parsed.bytes.byteLength > 256 * 1024) return { ok: false as const, error: 'too_large' as const }
    if (kind === 'favicon') this.persisted.site.faviconDataUrl = dataUrl
    else this.persisted.site.logoDataUrl = dataUrl
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: `site_asset:${kind}` })
    await this.persist()
    return { ok: true as const }
  }

  async clearSiteAsset(kind: 'favicon' | 'logo') {
    await this.init()
    if (kind === 'favicon') this.persisted.site.faviconDataUrl = undefined
    else this.persisted.site.logoDataUrl = undefined
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: `site_asset_clear:${kind}` })
    await this.persist()
    return { ok: true as const }
  }

  getEvents(limit = 80) {
    return this.events.slice(-limit)
  }

  async deleteEvents(ids: number[]) {
    await this.init()
    const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
    if (!list.length) return { ok: true as const, deleted: 0 }
    const unique = new Set(list.slice(0, 500))
    const before = this.events.length
    this.events = this.events.filter((e) => !e.id || !unique.has(e.id))
    const deleted = before - this.events.length
    return { ok: true as const, deleted }
  }

  async clearIpStats(ips: string[]) {
    await this.init()
    const list = Array.isArray(ips) ? ips.map((s) => normalizeIp(String(s))).filter(Boolean) : []
    const unique = Array.from(new Set(list)).slice(0, 200)
    for (const ip of unique) this.ipStats.delete(ip)
    if (unique.length) this.pushEvent({ ts: now(), kind: 'settings_update', detail: `top_ip_clear:${unique.length}` })
    return { ok: true as const, cleared: unique.length }
  }

  async clearDomainStats(domains: string[]) {
    await this.init()
    const list = Array.isArray(domains) ? domains.map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean) : []
    const unique = Array.from(new Set(list)).slice(0, 200)
    for (const d of unique) this.domainStats.delete(d)
    if (unique.length) this.pushEvent({ ts: now(), kind: 'settings_update', detail: `top_domain_clear:${unique.length}` })
    return { ok: true as const, cleared: unique.length }
  }

  private pushEvent(e: SecurityEvent) {
    const withId: SecurityEvent = e.id != null ? e : { ...e, id: ++this.eventSeq }
    this.events.push(withId)
    if (this.events.length > 500) this.events = this.events.slice(-400)
  }

  private maybeCleanup(ts: number) {
    const settings = this.persisted.settings
    const cleanupEnabled = !!settings.cleanup?.enabled
    const trafficEnabled = !!settings.traffic?.enabled
    if (!cleanupEnabled && !trafficEnabled) return
    if (ts - this.lastCleanupAt < 60 * 1000) return
    this.lastCleanupAt = ts

    if (cleanupEnabled) {
      const eventCutoff = ts - clamp(Number(settings.cleanup.eventRetentionDays), 1, 365) * 24 * 60 * 60 * 1000
      this.events = this.events.filter((e) => Number(e.ts) >= eventCutoff)

      const topCutoff = ts - clamp(Number(settings.cleanup.topRetentionDays), 1, 365) * 24 * 60 * 60 * 1000
      for (const [ip, st] of this.ipStats.entries()) {
        if (!st || typeof st.windowStart !== 'number' || st.windowStart < topCutoff) this.ipStats.delete(ip)
      }
      for (const [domain, st] of this.domainStats.entries()) {
        if (!st || typeof st.windowStart !== 'number' || st.windowStart < topCutoff) this.domainStats.delete(domain)
      }
    }

    if (trafficEnabled) {
      const trafficKeepDays = clamp(Number(settings.traffic?.retentionDays ?? 30), 1, 365)
      const trafficCutoff = ts - trafficKeepDays * 24 * 60 * 60 * 1000
      for (const [bucketStart, st] of this.trafficByHour.entries()) {
        if (!st || typeof st.bucketStart !== 'number' || bucketStart < trafficCutoff) this.trafficByHour.delete(bucketStart)
      }
      // 清理客户端流量记录
      for (const [key] of this.clientTrafficByHour.entries()) {
        const parts = key.split(':')
        if (parts.length >= 3) {
          const bucketStart = Number(parts[2])
          if (!Number.isFinite(bucketStart) || bucketStart < trafficCutoff) {
            this.clientTrafficByHour.delete(key)
          }
        }
      }
    }
  }

  logEvent(e: Omit<SecurityEvent, 'ts'> & { ts?: number }) {
    this.pushEvent({ ts: typeof e.ts === 'number' ? e.ts : now(), kind: e.kind, ip: e.ip, domain: e.domain, path: e.path, detail: e.detail })
  }

  observeEnd(params: { ts: number; path: string; status: number; bytes: number; ip?: string; domain?: string }) {
    const ts = typeof params.ts === 'number' ? params.ts : now()
    this.maybeCleanup(ts)
    if (!this.persisted.settings.traffic?.enabled) return
    const path = String(params.path ?? '')
    if (!(path.startsWith('/gh/') || path.startsWith('/npm/') || path === '/cdn')) return
    const status = Number(params.status || 0) || 0
    if (status < 200 || status >= 400) return
    const bytes = Number(params.bytes || 0) || 0
    if (!Number.isFinite(bytes) || bytes <= 0) return
    const hourMs = 60 * 60 * 1000
    const bucketStart = Math.floor(ts / hourMs) * hourMs
    const st = this.trafficByHour.get(bucketStart) ?? { bucketStart, bytes: 0, requests: 0 }
    st.bytes += bytes
    st.requests += 1
    this.trafficByHour.set(bucketStart, st)

    // 记录客户端维度的流量
    const ip = params.ip ? normalizeIp(params.ip) : ''
    const domain = params.domain ? String(params.domain).trim().toLowerCase() : ''
    if (ip && !isLoopbackIp(ip) && isProbablyIp(ip)) {
      const ipKey = `ip:${ip}:${bucketStart}`
      const ipSt = this.clientTrafficByHour.get(ipKey) as IpTrafficStat | undefined
      if (ipSt) {
        ipSt.bytes += bytes
        ipSt.requests += 1
      } else {
        this.clientTrafficByHour.set(ipKey, { ip, bucketStart, bytes, requests: 1 })
      }
    }
    if (domain && !isLocalDomain(domain) && isProbablyDomain(domain)) {
      const domainKey = `domain:${domain}:${bucketStart}`
      const domainSt = this.clientTrafficByHour.get(domainKey) as DomainTrafficStat | undefined
      if (domainSt) {
        domainSt.bytes += bytes
        domainSt.requests += 1
      } else {
        this.clientTrafficByHour.set(domainKey, { domain, bucketStart, bytes, requests: 1 })
      }
    }
  }

  clearTraffic(params: { hours?: number[]; days?: number[]; all?: boolean; ips?: string[]; domains?: string[] }) {
    const p = params || {}
    const cleared: { clearedHours: number; clearedDays: number; clearedAll: boolean; clearedIps: number; clearedDomains: number } = { clearedHours: 0, clearedDays: 0, clearedAll: false, clearedIps: 0, clearedDomains: 0 }
    if (p.all) {
      const n = this.trafficByHour.size
      this.trafficByHour.clear()
      this.clientTrafficByHour.clear()
      cleared.clearedHours = n
      cleared.clearedAll = true
      return cleared
    }
    const hourList = Array.isArray(p.hours) ? p.hours.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
    const hourSet = new Set(hourList.slice(0, 2000))
    for (const b of hourSet) {
      if (this.trafficByHour.delete(b)) cleared.clearedHours++
      // 同时清理客户端流量
      for (const [key] of this.clientTrafficByHour.entries()) {
        const parts = key.split(':')
        if (parts.length >= 3 && Number(parts[2]) === b) {
          this.clientTrafficByHour.delete(key)
        }
      }
    }
    const dayList = Array.isArray(p.days) ? p.days.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
    const daySet = new Set(dayList.slice(0, 400))
    if (daySet.size) {
      const dayMs = 24 * 60 * 60 * 1000
      const hourMs = 60 * 60 * 1000
      for (const [bucketStart] of this.trafficByHour.entries()) {
        const dayBucket = Math.floor(bucketStart / dayMs) * dayMs
        if (!daySet.has(dayBucket)) continue
        if (this.trafficByHour.delete(bucketStart)) cleared.clearedDays++
        // 同时清理客户端流量
        for (const [key] of this.clientTrafficByHour.entries()) {
          const parts = key.split(':')
          if (parts.length >= 3 && Number(parts[2]) === bucketStart) {
            this.clientTrafficByHour.delete(key)
          }
        }
      }
      if (hourMs && dayMs) void 0
    }
    // 按 IP 删除客户端流量
    const ipList = Array.isArray(p.ips) ? p.ips.map((s) => normalizeIp(String(s))).filter(Boolean) : []
    if (ipList.length) {
      const ipSet = new Set(ipList)
      for (const [key] of this.clientTrafficByHour.entries()) {
        const parts = key.split(':')
        if (parts.length >= 2 && parts[0] === 'ip' && ipSet.has(parts[1])) {
          this.clientTrafficByHour.delete(key)
          cleared.clearedIps++
        }
      }
    }
    // 按域名删除客户端流量
    const domainList = Array.isArray(p.domains) ? p.domains.map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean) : []
    if (domainList.length) {
      const domainSet = new Set(domainList)
      for (const [key] of this.clientTrafficByHour.entries()) {
        const parts = key.split(':')
        if (parts.length >= 2 && parts[0] === 'domain' && domainSet.has(parts[1])) {
          this.clientTrafficByHour.delete(key)
          cleared.clearedDomains++
        }
      }
    }
    return cleared
  }

  getTraffic() {
    const enabled = !!this.persisted.settings.traffic?.enabled
    const retentionDays = clamp(Number(this.persisted.settings.traffic?.retentionDays ?? 30), 1, 365)
    if (!enabled) {
      return {
        enabled: false,
        retentionDays,
        totals: { last24Bytes: 0, last24Requests: 0, last7dBytes: 0, last7dRequests: 0, last30dBytes: 0, last30dRequests: 0 },
        hourly: [],
        daily: [],
        topIps: [],
        topDomains: []
      }
    }
    this.maybeCleanup(now())
    const ts = now()
    const hourMs = 60 * 60 * 1000
    const dayMs = 24 * 60 * 60 * 1000
    const nowHour = Math.floor(ts / hourMs) * hourMs
    const cutoff24 = ts - 24 * hourMs
    const cutoff7 = ts - 7 * dayMs
    const cutoff30 = ts - 30 * dayMs

    // 按客户端 IP 聚合流量
    const ipTrafficMap = new Map<string, { ip: string; bytes: number; requests: number }>()
    const domainTrafficMap = new Map<string, { domain: string; bytes: number; requests: number }>()
    for (const [, st] of this.clientTrafficByHour.entries()) {
      if (!st || st.bucketStart < cutoff30) continue
      if ('ip' in st) {
        const cur = ipTrafficMap.get(st.ip) ?? { ip: st.ip, bytes: 0, requests: 0 }
        cur.bytes += st.bytes
        cur.requests += st.requests
        ipTrafficMap.set(st.ip, cur)
      } else if ('domain' in st) {
        const cur = domainTrafficMap.get(st.domain) ?? { domain: st.domain, bytes: 0, requests: 0 }
        cur.bytes += st.bytes
        cur.requests += st.requests
        domainTrafficMap.set(st.domain, cur)
      }
    }
    const topIps = Array.from(ipTrafficMap.values())
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 50)
    const topDomains = Array.from(domainTrafficMap.values())
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 50)

    // 按时间聚合的流量
    const hourly: TrafficBucketStat[] = []
    for (let i = 23; i >= 0; i--) {
      const b = nowHour - i * hourMs
      const st = this.trafficByHour.get(b)
      hourly.push({ bucketStart: b, bytes: st?.bytes || 0, requests: st?.requests || 0 })
    }

    let last24Bytes = 0
    let last24Requests = 0
    let last7dBytes = 0
    let last7dRequests = 0
    let last30dBytes = 0
    let last30dRequests = 0
    for (const [bucketStart, st] of this.trafficByHour.entries()) {
      if (!st) continue
      if (bucketStart >= cutoff30) {
        last30dBytes += st.bytes
        last30dRequests += st.requests
      }
      if (bucketStart >= cutoff7) {
        last7dBytes += st.bytes
        last7dRequests += st.requests
      }
      if (bucketStart >= cutoff24) {
        last24Bytes += st.bytes
        last24Requests += st.requests
      }
    }

    const dayStart = Math.floor(ts / dayMs) * dayMs
    const dailyMap = new Map<number, TrafficBucketStat>()
    for (let i = 29; i >= 0; i--) {
      const b = dayStart - i * dayMs
      dailyMap.set(b, { bucketStart: b, bytes: 0, requests: 0 })
    }
    for (const [bucketStart, st] of this.trafficByHour.entries()) {
      if (!st) continue
      if (bucketStart < cutoff30) continue
      const dayBucket = Math.floor(bucketStart / dayMs) * dayMs
      const cur = dailyMap.get(dayBucket)
      if (!cur) continue
      cur.bytes += st.bytes
      cur.requests += st.requests
      dailyMap.set(dayBucket, cur)
    }
    const daily = Array.from(dailyMap.values())

    return {
      enabled: true,
      retentionDays,
      totals: { last24Bytes, last24Requests, last7dBytes, last7dRequests, last30dBytes, last30dRequests },
      hourly,
      daily,
      topIps,
      topDomains
    }
  }

  private isExpired(b: BanEntry) {
    return typeof b.expiresAt === 'number' && now() > b.expiresAt
  }

  private cleanupBans() {
    const before = this.persisted.bans.length
    this.persisted.bans = this.persisted.bans.filter((b) => !this.isExpired(b))
    return before !== this.persisted.bans.length
  }

  private async persist() {
    this.cleanupBans()
    await writeJsonFile(this.storePath, this.persisted)
  }

  async updateSettings(next: Partial<SecuritySettings>) {
    await this.init()
    const cur = this.persisted.settings
    const prevTrafficEnabled = !!cur.traffic?.enabled
    const merged: SecuritySettings = {
      enabled: next.enabled != null ? !!next.enabled : cur.enabled,
      banSeconds:
        next.banSeconds != null ? clamp(Number(next.banSeconds), 60, 60 * 60 * 24 * 30) : clamp(cur.banSeconds, 60, 60 * 60 * 24 * 30),
      rate: {
        enabled: next.rate?.enabled != null ? !!next.rate.enabled : cur.rate.enabled,
        windowSeconds:
          next.rate?.windowSeconds != null
            ? clamp(Number(next.rate.windowSeconds), 10, 3600)
            : clamp(cur.rate.windowSeconds, 10, 3600),
        maxRequests:
          next.rate?.maxRequests != null
            ? clamp(Number(next.rate.maxRequests), 10, 10000)
            : clamp(cur.rate.maxRequests, 10, 10000)
      },
      scan: {
        enabled: next.scan?.enabled != null ? !!next.scan.enabled : cur.scan.enabled,
        windowSeconds:
          next.scan?.windowSeconds != null
            ? clamp(Number(next.scan.windowSeconds), 10, 3600)
            : clamp(cur.scan.windowSeconds, 10, 3600),
        maxHits: next.scan?.maxHits != null ? clamp(Number(next.scan.maxHits), 1, 1000) : clamp(cur.scan.maxHits, 1, 1000)
      },
      refererAbuse: {
        enabled: next.refererAbuse?.enabled != null ? !!next.refererAbuse.enabled : cur.refererAbuse.enabled,
        windowSeconds:
          next.refererAbuse?.windowSeconds != null
            ? clamp(Number(next.refererAbuse.windowSeconds), 10, 3600)
            : clamp(cur.refererAbuse.windowSeconds, 10, 3600),
        maxRequests:
          next.refererAbuse?.maxRequests != null
            ? clamp(Number(next.refererAbuse.maxRequests), 10, 10000)
            : clamp(cur.refererAbuse.maxRequests, 10, 10000)
      },
      registrationEnabled: next.registrationEnabled != null ? !!next.registrationEnabled : cur.registrationEnabled,
      cleanup: {
        enabled: next.cleanup?.enabled != null ? !!next.cleanup.enabled : cur.cleanup.enabled,
        eventRetentionDays:
          next.cleanup?.eventRetentionDays != null
            ? clamp(Number(next.cleanup.eventRetentionDays), 1, 365)
            : clamp(cur.cleanup.eventRetentionDays, 1, 365),
        topRetentionDays:
          next.cleanup?.topRetentionDays != null
            ? clamp(Number(next.cleanup.topRetentionDays), 1, 365)
            : clamp(cur.cleanup.topRetentionDays, 1, 365)
      },
      traffic: {
        enabled: next.traffic?.enabled != null ? !!next.traffic.enabled : !!cur.traffic?.enabled,
        retentionDays:
          next.traffic?.retentionDays != null
            ? clamp(Number(next.traffic.retentionDays), 1, 365)
            : clamp(Number(cur.traffic?.retentionDays ?? DEFAULT_SETTINGS.traffic.retentionDays), 1, 365)
      }
    }
    this.persisted.settings = merged
    if (prevTrafficEnabled && !merged.traffic.enabled) this.clearTraffic({ all: true })
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: 'settings updated' })
    await this.persist()
    return merged
  }

  async setAnnouncements(list: { id?: string; text: string; enabled?: boolean }[]) {
    await this.init()
    const clean = Array.isArray(list) ? list : []
    const out: Announcement[] = []
    for (const item of clean) {
      const text = String(item?.text ?? '').trim()
      if (!text) continue
      const id = String(item?.id ?? '').trim() || randomId()
      const existing = this.persisted.announcements.find((a) => a.id === id)
      const createdAt = existing?.createdAt ?? now()
      out.push({ id, text, enabled: item?.enabled != null ? !!item.enabled : true, createdAt, updatedAt: now() })
    }
    this.persisted.announcements = out
    this.pushEvent({ ts: now(), kind: 'announcement_update', detail: `announcements=${out.length}` })
    await this.persist()
    return out
  }

  async addBan(input: { type: BanType; value: string; reason?: string; seconds?: number; createdBy?: 'manual' | 'auto' }) {
    await this.init()
    const type: BanType = input.type
    const rawValue = String(input.value ?? '').trim().toLowerCase()
    if (type === 'ip' && !isProbablyIp(rawValue)) return { ok: false as const, error: 'invalid_ip' as const }
    if (type === 'domain' && !isProbablyDomain(rawValue)) return { ok: false as const, error: 'invalid_domain' as const }
    const expiresAt =
      typeof input.seconds === 'number' && input.seconds > 0 ? now() + clamp(Math.floor(input.seconds), 60, 60 * 60 * 24 * 30) * 1000 : undefined
    const entry: BanEntry = {
      type,
      value: rawValue,
      reason: input.reason?.trim() || undefined,
      createdAt: now(),
      createdBy: input.createdBy === 'auto' ? 'auto' : 'manual',
      expiresAt
    }
    this.persisted.bans = this.persisted.bans.filter((b) => !(b.type === entry.type && b.value === entry.value))
    this.persisted.bans.push(entry)
    this.pushEvent({ ts: now(), kind: entry.createdBy === 'auto' ? 'auto_ban' : 'manual_ban', ip: type === 'ip' ? rawValue : undefined, domain: type === 'domain' ? rawValue : undefined, detail: entry.reason })
    await this.persist()
    return { ok: true as const, entry }
  }

  async removeBan(type: BanType, value: string) {
    await this.init()
    const v = String(value ?? '').trim().toLowerCase()
    const before = this.persisted.bans.length
    this.persisted.bans = this.persisted.bans.filter((b) => !(b.type === type && b.value === v))
    if (this.persisted.bans.length !== before) {
      this.pushEvent({ ts: now(), kind: 'unban', ip: type === 'ip' ? v : undefined, domain: type === 'domain' ? v : undefined })
      await this.persist()
    }
    return true
  }

  async removeBans(list: { type: BanType; value: string }[]) {
    await this.init()
    const input = Array.isArray(list) ? list : []
    const set = new Set<string>()
    for (const item of input.slice(0, 500)) {
      const type: BanType = item?.type === 'domain' ? 'domain' : 'ip'
      const value = String(item?.value ?? '').trim().toLowerCase()
      if (!value) continue
      set.add(`${type}:${value}`)
    }
    if (!set.size) return { ok: true as const, deleted: 0 }
    const before = this.persisted.bans.length
    this.persisted.bans = this.persisted.bans.filter((b) => !set.has(`${b.type}:${b.value}`))
    const deleted = before - this.persisted.bans.length
    if (deleted > 0) {
      this.pushEvent({ ts: now(), kind: 'settings_update', detail: `bans_delete:${deleted}` })
      await this.persist()
    }
    return { ok: true as const, deleted }
  }

  private isManuallyBanned(ip: string, domain: string) {
    const cleaned = this.cleanupBans()
    if (cleaned) void this.persist()
    const nowTs = now()
    for (const b of this.persisted.bans) {
      if (typeof b.expiresAt === 'number' && b.expiresAt <= nowTs) continue
      if (b.type === 'ip' && ip && b.value === ip) return b
      if (b.type === 'domain' && domain && b.value === domain) return b
    }
    return null
  }

  observeStart(params: { ip: string; domain: string; path: string }) {
    const settings = this.persisted.settings
    if (!settings.enabled) return { blocked: false as const }
    this.maybeCleanup(now())

    const ipRaw = normalizeIp(params.ip)
    const ip = isLoopbackIp(ipRaw) ? '' : isProbablyIp(ipRaw) ? ipRaw : ''
    const domainRaw = String(params.domain ?? '').trim().toLowerCase()
    const domain = isLocalDomain(domainRaw) ? '' : isProbablyDomain(domainRaw) ? domainRaw : ''
    const path = params.path

    const manual = this.isManuallyBanned(ip, domain)
    if (manual) {
      this.pushEvent({ ts: now(), kind: 'blocked', ip, domain, path, detail: `${manual.type}:${manual.value}` })
      return { blocked: true as const, reason: manual.reason || 'banned' }
    }

    const ts = now()

    if (settings.rate.enabled && ip) {
      const st = this.ipStats.get(ip) ?? { windowStart: ts, requests: 0, scanHits: 0 }
      if (ts - st.windowStart > settings.rate.windowSeconds * 1000) {
        st.windowStart = ts
        st.requests = 0
        st.scanHits = 0
      }
      st.requests++
      this.ipStats.set(ip, st)
      if (st.requests > settings.rate.maxRequests) {
        void this.addBan({ type: 'ip', value: ip, reason: `rate_limit>${settings.rate.maxRequests}/${settings.rate.windowSeconds}s`, seconds: settings.banSeconds, createdBy: 'auto' })
        this.pushEvent({ ts, kind: 'blocked', ip, domain, path, detail: 'auto_rate_limit' })
        return { blocked: true as const, reason: 'rate_limited' }
      }
    }

    if (settings.scan.enabled && ip) {
      const lowered = path.toLowerCase()
      const hit = SCAN_PATHS.some((p) => lowered.startsWith(p))
      if (hit) {
        const st = this.ipStats.get(ip) ?? { windowStart: ts, requests: 0, scanHits: 0 }
        if (ts - st.windowStart > settings.scan.windowSeconds * 1000) {
          st.windowStart = ts
          st.requests = 0
          st.scanHits = 0
        }
        st.scanHits++
        this.ipStats.set(ip, st)
        if (st.scanHits >= settings.scan.maxHits) {
          void this.addBan({ type: 'ip', value: ip, reason: `scan_hits>=${settings.scan.maxHits}/${settings.scan.windowSeconds}s`, seconds: settings.banSeconds, createdBy: 'auto' })
          this.pushEvent({ ts, kind: 'blocked', ip, domain, path, detail: 'auto_scan' })
          return { blocked: true as const, reason: 'scan_detected' }
        }
      }
    }

    if (settings.refererAbuse.enabled && domain) {
      const st = this.domainStats.get(domain) ?? { windowStart: ts, requests: 0 }
      if (ts - st.windowStart > settings.refererAbuse.windowSeconds * 1000) {
        st.windowStart = ts
        st.requests = 0
      }
      st.requests++
      this.domainStats.set(domain, st)
      if (st.requests > settings.refererAbuse.maxRequests) {
        void this.addBan({
          type: 'domain',
          value: domain,
          reason: `referer_abuse>${settings.refererAbuse.maxRequests}/${settings.refererAbuse.windowSeconds}s`,
          seconds: settings.banSeconds,
          createdBy: 'auto'
        })
        this.pushEvent({ ts, kind: 'blocked', ip, domain, path, detail: 'auto_domain_abuse' })
        return { blocked: true as const, reason: 'domain_blocked' }
      }
    }

    return { blocked: false as const }
  }

  getOverview() {
    this.maybeCleanup(now())
    const settings = this.persisted.settings
    const site = this.getSiteSettings()
    const bans = this.persisted.bans.filter((b) => !this.isExpired(b))
    const announcements = this.persisted.announcements
    const events = this.getEvents(120)
    const topIps = Array.from(this.ipStats.entries())
      .filter(([ip]) => !!ip && !isLoopbackIp(ip) && isProbablyIp(ip))
      .map(([ip, st]) => ({ ip, windowStart: st.windowStart, requests: st.requests, scanHits: st.scanHits }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 50)
    const topDomains = Array.from(this.domainStats.entries())
      .filter(([domain]) => !!domain && !isLocalDomain(domain) && isProbablyDomain(domain))
      .map(([domain, st]) => ({ domain, windowStart: st.windowStart, requests: st.requests }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 50)
    const traffic = this.getTraffic()
    return { settings, site, bans, announcements, events, topIps, topDomains, traffic }
  }
}

export const getAdminStore = () => {
  const g = globalThis as any
  if (!g.__JSD_ADMIN_STORE__) g.__JSD_ADMIN_STORE__ = new AdminStore()
  return g.__JSD_ADMIN_STORE__ as AdminStore
}

export const buildBlockedResponse = (reason: string) =>
  new Response(JSON.stringify({ error: 'forbidden', reason }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
