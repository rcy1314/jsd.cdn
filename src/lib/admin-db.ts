import type { AppDb } from './db.js'
import type { Announcement, BanEntry, BanType, SecurityEvent, SecuritySettings, SiteSettings } from './admin.js'

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

type IpTrafficByHourStat = {
  ip: string
  bucketStart: number
  bytes: number
  requests: number
}

type DomainTrafficByHourStat = {
  domain: string
  bucketStart: number
  bytes: number
  requests: number
}

type IpTrafficStat = {
  ip: string
  bytes: number
  requests: number
}

type DomainTrafficStat = {
  domain: string
  bytes: number
  requests: number
}

const now = () => Date.now()

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const isProbablyDomain = (value: string) => {
  const v = String(value ?? '').trim().toLowerCase()
  if (!v) return false
  if (v.includes('/') || v.includes(':')) return false
  if (v === 'localhost') return true
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)
}

const normalizeIp = (ip: string) => {
  const s = String(ip ?? '').trim()
  if (!s) return ''
  const cleaned = s.split(',')[0]?.trim() ?? ''
  if (cleaned.startsWith('::ffff:')) return cleaned.slice('::ffff:'.length)
  return cleaned
}

const isProbablyIp = (value: string) => {
  const v = normalizeIp(value)
  if (!v) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return true
  return /^[0-9a-f:]+$/i.test(v)
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

// 高危路径：单次命中立即封禁（无需累计次数）
const INSTANT_BAN_PATHS = [
  '/.env',
  '/.git',
  '/.svn',
  '/.htaccess',
  '/.htpasswd',
  '/.ssh',
  '/.aws',
  '/.docker',
  '/etc/passwd',
  '/etc/shadow',
  '/proc/self',
]

// 通用恶意扫描路径：累计命中达阈值后封禁
const SCAN_PATHS = [
  // WordPress
  '/wp-admin',
  '/wp-login.php',
  '/wp-config.php',
  '/wp-includes',
  '/wp-content',
  '/xmlrpc.php',
  // 数据库管理工具
  '/phpmyadmin',
  '/pma',
  '/mysql',
  '/myadmin',
  '/mysqladmin',
  // 常见后台路径
  '/administrator',
  '/admin.php',
  '/admin/login',
  '/manage',
  '/management',
  '/controlpanel',
  '/cpanel',
  '/panel',
  // PHP 探测
  '/phpinfo.php',
  '/info.php',
  '/test.php',
  '/shell.php',
  '/cmd.php',
  '/upload.php',
  '/webshell',
  '/backdoor',
  // Java/Spring
  '/actuator',
  '/manager/html',
  '/solr',
  '/console',
  '/jolokia',
  '/jmx-console',
  // 通用扫描特征
  '/cgi-bin',
  '/config',
  '/server-status',
  '/server-info',
  '/setup.php',
  '/install.php',
  '/readme.html',
  '/license.txt',
  // 其他
  '/autodiscover',
  '/owa/',
  '/ecp/',
  '/ews/',
]

export class AdminDbStore {
  private readonly db: AppDb
  private ready = false
  private events: SecurityEvent[] = []
  private ipStats = new Map<string, IpWindowStat>()
  private domainStats = new Map<string, DomainWindowStat>()
  private trafficByHour = new Map<number, TrafficBucketStat>()
  private clientTrafficByHour = new Map<string, IpTrafficByHourStat | DomainTrafficByHourStat>()
  private lastCleanupAt = 0

  constructor(db: AppDb) {
    this.db = db
  }

  async init() {
    if (this.ready) return
    this.ready = true
    // 从 DB 恢复流量数据到内存
    try {
      const hourRows = this.db.prepare('SELECT bucket_start, bytes, requests FROM traffic_hourly').all() as any[]
      for (const r of hourRows) {
        const bucketStart = Number(r.bucket_start)
        if (!Number.isFinite(bucketStart)) continue
        this.trafficByHour.set(bucketStart, { bucketStart, bytes: Number(r.bytes) || 0, requests: Number(r.requests) || 0 })
      }
      const ipRows = this.db.prepare('SELECT ip, bucket_start, bytes, requests FROM traffic_ip_hourly').all() as any[]
      for (const r of ipRows) {
        const ip = String(r.ip ?? '')
        const bucketStart = Number(r.bucket_start)
        if (!ip || !Number.isFinite(bucketStart)) continue
        const key = `ip:${ip}:${bucketStart}`
        this.clientTrafficByHour.set(key, { ip, bucketStart, bytes: Number(r.bytes) || 0, requests: Number(r.requests) || 0 })
      }
      const domainRows = this.db.prepare('SELECT domain, bucket_start, bytes, requests FROM traffic_domain_hourly').all() as any[]
      for (const r of domainRows) {
        const domain = String(r.domain ?? '')
        const bucketStart = Number(r.bucket_start)
        if (!domain || !Number.isFinite(bucketStart)) continue
        const key = `domain:${domain}:${bucketStart}`
        this.clientTrafficByHour.set(key, { domain, bucketStart, bytes: Number(r.bytes) || 0, requests: Number(r.requests) || 0 })
      }

      if (this.clientTrafficByHour.size === 0) {
        const nowHour = Math.floor(now() / (60 * 60 * 1000)) * (60 * 60 * 1000)
        try {
          const legacyIps = this.db.prepare('SELECT ip, bytes, requests FROM traffic_ip').all() as any[]
          for (const r of legacyIps) {
            const ip = String(r.ip ?? '')
            if (!ip) continue
            const bytes = Number(r.bytes) || 0
            const requests = Number(r.requests) || 0
            const key = `ip:${ip}:${nowHour}`
            this.clientTrafficByHour.set(key, { ip, bucketStart: nowHour, bytes, requests })
            this.db
              .prepare(
                'INSERT INTO traffic_ip_hourly (ip, bucket_start, bytes, requests) VALUES (?, ?, ?, ?) ON CONFLICT(ip, bucket_start) DO UPDATE SET bytes=excluded.bytes, requests=excluded.requests'
              )
              .run(ip, nowHour, bytes, requests)
          }
          const legacyDomains = this.db.prepare('SELECT domain, bytes, requests FROM traffic_domain').all() as any[]
          for (const r of legacyDomains) {
            const domain = String(r.domain ?? '')
            if (!domain) continue
            const bytes = Number(r.bytes) || 0
            const requests = Number(r.requests) || 0
            const key = `domain:${domain}:${nowHour}`
            this.clientTrafficByHour.set(key, { domain, bucketStart: nowHour, bytes, requests })
            this.db
              .prepare(
                'INSERT INTO traffic_domain_hourly (domain, bucket_start, bytes, requests) VALUES (?, ?, ?, ?) ON CONFLICT(domain, bucket_start) DO UPDATE SET bytes=excluded.bytes, requests=excluded.requests'
              )
              .run(domain, nowHour, bytes, requests)
          }
          this.db.prepare('DELETE FROM traffic_ip').run()
          this.db.prepare('DELETE FROM traffic_domain').run()
        } catch {}
      }
    } catch {}
  }

  private getSettingsRow() {
    return this.db
      .prepare(
        `SELECT
          enabled,
          ban_seconds,
          rate_enabled,
          rate_window_seconds,
          rate_max_requests,
          scan_enabled,
          scan_window_seconds,
          scan_max_hits,
          ref_enabled,
          ref_window_seconds,
          ref_max_requests,
          registration_enabled,
          cleanup_enabled,
          events_retention_days,
          top_retention_days,
          traffic_enabled,
          traffic_retention_days
        FROM security_settings WHERE id=1`
      )
      .get()
  }

  private getSiteSettingsRow() {
    return this.db
      .prepare('SELECT footer_text, footer_format, title, description, announcement_format, favicon_url, logo_url FROM site_settings WHERE id=1')
      .get()
  }

  getSettings(): SecuritySettings {
    const row = this.getSettingsRow()
    return {
      enabled: !!row?.enabled,
      banSeconds: clamp(Number(row?.ban_seconds ?? 3600), 60, 60 * 60 * 24 * 30),
      rate: {
        enabled: !!row?.rate_enabled,
        windowSeconds: clamp(Number(row?.rate_window_seconds ?? 60), 10, 3600),
        maxRequests: clamp(Number(row?.rate_max_requests ?? 240), 10, 10000)
      },
      scan: {
        enabled: !!row?.scan_enabled,
        windowSeconds: clamp(Number(row?.scan_window_seconds ?? 60), 10, 3600),
        maxHits: clamp(Number(row?.scan_max_hits ?? 8), 1, 1000)
      },
      refererAbuse: {
        enabled: !!row?.ref_enabled,
        windowSeconds: clamp(Number(row?.ref_window_seconds ?? 60), 10, 3600),
        maxRequests: clamp(Number(row?.ref_max_requests ?? 180), 10, 10000)
      },
      registrationEnabled: !!row?.registration_enabled,
      cleanup: {
        enabled: row?.cleanup_enabled != null ? !!row.cleanup_enabled : true,
        eventRetentionDays: clamp(Number(row?.events_retention_days ?? 14), 1, 365),
        topRetentionDays: clamp(Number(row?.top_retention_days ?? 7), 1, 365)
      },
      traffic: {
        enabled: !!row?.traffic_enabled,
        retentionDays: clamp(Number(row?.traffic_retention_days ?? 30), 1, 365)
      }
    }
  }

  getSiteSettings(): SiteSettings {
    const row = this.getSiteSettingsRow()
    return {
      footerText: typeof row?.footer_text === 'string' ? row.footer_text : '',
      footerFormat: row?.footer_format === 'html' || row?.footer_format === 'md' ? row.footer_format : 'text',
      title: typeof row?.title === 'string' ? row.title : '',
      description: typeof row?.description === 'string' ? row.description : '',
      announcementFormat: row?.announcement_format === 'html' || row?.announcement_format === 'md' ? row.announcement_format : 'text',
      faviconUrl: typeof row?.favicon_url === 'string' ? row.favicon_url : '',
      logoUrl: typeof row?.logo_url === 'string' ? row.logo_url : ''
    }
  }

  getSiteAsset(kind: 'favicon' | 'logo') {
    const row = this.db.prepare('SELECT mime, data FROM site_assets WHERE kind=?').get(kind)
    if (!row) return null
    const mime = typeof row?.mime === 'string' ? row.mime : ''
    const data = row?.data
    if (!mime || !data) return null
    return { mime, data }
  }

  getBans(): BanEntry[] {
    this.cleanupExpiredBans()
    const rows = this.db.prepare('SELECT type, value, reason, created_at, created_by, expires_at FROM bans').all() as any[]
    const ts = now()
    const out: BanEntry[] = []
    for (const r of rows) {
      const expiresAt = r.expires_at != null ? Number(r.expires_at) : undefined
      if (typeof expiresAt === 'number' && expiresAt <= ts) continue
      const type = r.type === 'domain' ? 'domain' : 'ip'
      out.push({
        type,
        value: String(r.value),
        reason: typeof r.reason === 'string' ? r.reason : undefined,
        createdAt: Number(r.created_at) || ts,
        createdBy: r.created_by === 'auto' ? 'auto' : 'manual',
        expiresAt
      })
    }
    return out
  }

  private cleanupExpiredBans() {
    const ts = now()
    this.db.prepare('DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ?').run(ts)
  }

  private pushEvent(e: SecurityEvent) {
    const info = this.db
      .prepare('INSERT INTO security_events (ts, kind, ip, domain, path, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.ts, e.kind, e.ip ?? null, e.domain ?? null, e.path ?? null, e.detail ?? null)
    const idRaw = info?.lastInsertRowid
    let id = typeof idRaw === 'bigint' ? Number(idRaw) : typeof idRaw === 'number' ? idRaw : 0
    if (!id) {
      const row = this.db.prepare('SELECT last_insert_rowid() AS id').get()
      const v = row?.id
      id = typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v) || 0
    }
    const withId: SecurityEvent = id > 0 ? { ...e, id } : e
    this.events.push(withId)
    if (this.events.length > 500) this.events = this.events.slice(-400)
  }

  private maybeCleanup(ts: number) {
    const settings = this.getSettings()
    const cleanupEnabled = !!settings.cleanup?.enabled
    const trafficEnabled = !!settings.traffic?.enabled
    if (!cleanupEnabled && !trafficEnabled) return
    if (ts - this.lastCleanupAt < 60 * 1000) return
    this.lastCleanupAt = ts

    if (cleanupEnabled) {
      const eventCutoff = ts - clamp(Number(settings.cleanup.eventRetentionDays), 1, 365) * 24 * 60 * 60 * 1000
      try {
        this.db.prepare('DELETE FROM security_events WHERE ts < ?').run(eventCutoff)
      } catch {}
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
        if (!st || typeof st.bucketStart !== 'number' || bucketStart < trafficCutoff) {
          this.trafficByHour.delete(bucketStart)
          try { this.db.prepare('DELETE FROM traffic_hourly WHERE bucket_start=?').run(bucketStart) } catch {}
          try { this.db.prepare('DELETE FROM traffic_ip_hourly WHERE bucket_start=?').run(bucketStart) } catch {}
          try { this.db.prepare('DELETE FROM traffic_domain_hourly WHERE bucket_start=?').run(bucketStart) } catch {}
          for (const [key, v] of this.clientTrafficByHour.entries()) {
            if (!v || typeof (v as any).bucketStart !== 'number') continue
            if ((v as any).bucketStart === bucketStart) this.clientTrafficByHour.delete(key)
          }
        }
      }
      if (this.trafficByHour.size === 0) {
        this.clientTrafficByHour.clear()
        try { this.db.prepare('DELETE FROM traffic_ip_hourly').run() } catch {}
        try { this.db.prepare('DELETE FROM traffic_domain_hourly').run() } catch {}
        try { this.db.prepare('DELETE FROM traffic_ip').run() } catch {}
        try { this.db.prepare('DELETE FROM traffic_domain').run() } catch {}
      }
    }
  }

  logEvent(e: Omit<SecurityEvent, 'ts'> & { ts?: number }) {
    this.pushEvent({ ts: typeof e.ts === 'number' ? e.ts : now(), kind: e.kind, ip: e.ip, domain: e.domain, path: e.path, detail: e.detail })
  }

  observeEnd(params: { ts: number; path: string; status: number; bytes: number; ip?: string; domain?: string }) {
    const ts = typeof params.ts === 'number' ? params.ts : now()
    this.maybeCleanup(ts)
    if (!this.getSettings().traffic?.enabled) return
    const path = String(params.path ?? '')
    if (!(path.startsWith('/gh/') || path.startsWith('/npm/') || path === '/cdn')) return
    const status = Number(params.status || 0) || 0
    if (status < 200 || status >= 400) return
    const bytesRaw = Number(params.bytes || 0)
    const bytes = Number.isFinite(bytesRaw) && bytesRaw > 0 ? bytesRaw : 0
    const hourMs = 60 * 60 * 1000
    const bucketStart = Math.floor(ts / hourMs) * hourMs
    const st = this.trafficByHour.get(bucketStart) ?? { bucketStart, bytes: 0, requests: 0 }
    st.bytes += bytes
    st.requests += 1
    this.trafficByHour.set(bucketStart, st)
    try {
      this.db.prepare('INSERT INTO traffic_hourly (bucket_start, bytes, requests) VALUES (?, ?, ?) ON CONFLICT(bucket_start) DO UPDATE SET bytes=excluded.bytes, requests=excluded.requests').run(bucketStart, st.bytes, st.requests)
    } catch {}
    // 记录客户端维度的流量（按小时）
    const ip = params.ip ? normalizeIp(params.ip) : ''
    const domain = params.domain ? String(params.domain).trim().toLowerCase() : ''
    if (ip && !isLoopbackIp(ip) && isProbablyIp(ip)) {
      const ipKey = `ip:${ip}:${bucketStart}`
      const cur = this.clientTrafficByHour.get(ipKey) as IpTrafficByHourStat | undefined
      if (cur) {
        cur.bytes += bytes
        cur.requests += 1
      } else {
        this.clientTrafficByHour.set(ipKey, { ip, bucketStart, bytes, requests: 1 })
      }
      const st2 = this.clientTrafficByHour.get(ipKey) as IpTrafficByHourStat | undefined
      try {
        this.db
          .prepare(
            'INSERT INTO traffic_ip_hourly (ip, bucket_start, bytes, requests) VALUES (?, ?, ?, ?) ON CONFLICT(ip, bucket_start) DO UPDATE SET bytes=excluded.bytes, requests=excluded.requests'
          )
          .run(ip, bucketStart, st2?.bytes ?? bytes, st2?.requests ?? 1)
      } catch {}
    }
    if (domain && !isLocalDomain(domain) && isProbablyDomain(domain)) {
      const dKey = `domain:${domain}:${bucketStart}`
      const cur = this.clientTrafficByHour.get(dKey) as DomainTrafficByHourStat | undefined
      if (cur) {
        cur.bytes += bytes
        cur.requests += 1
      } else {
        this.clientTrafficByHour.set(dKey, { domain, bucketStart, bytes, requests: 1 })
      }
      const st2 = this.clientTrafficByHour.get(dKey) as DomainTrafficByHourStat | undefined
      try {
        this.db
          .prepare(
            'INSERT INTO traffic_domain_hourly (domain, bucket_start, bytes, requests) VALUES (?, ?, ?, ?) ON CONFLICT(domain, bucket_start) DO UPDATE SET bytes=excluded.bytes, requests=excluded.requests'
          )
          .run(domain, bucketStart, st2?.bytes ?? bytes, st2?.requests ?? 1)
      } catch {}
    }
  }

  clearTraffic(params: { hours?: number[]; days?: number[]; all?: boolean; ips?: string[]; domains?: string[] }) {
    const p = params || {}
    const cleared: { clearedHours: number; clearedDays: number; clearedAll: boolean; clearedIps: number; clearedDomains: number } = { clearedHours: 0, clearedDays: 0, clearedAll: false, clearedIps: 0, clearedDomains: 0 }
    if (p.all) {
      const n = this.trafficByHour.size
      this.trafficByHour.clear()
      this.clientTrafficByHour.clear()
      try { this.db.prepare('DELETE FROM traffic_hourly').run() } catch {}
      try { this.db.prepare('DELETE FROM traffic_ip_hourly').run() } catch {}
      try { this.db.prepare('DELETE FROM traffic_domain_hourly').run() } catch {}
      try { this.db.prepare('DELETE FROM traffic_ip').run() } catch {}
      try { this.db.prepare('DELETE FROM traffic_domain').run() } catch {}
      cleared.clearedHours = n
      cleared.clearedAll = true
      this.pushEvent({ ts: now(), kind: 'settings_update', detail: 'traffic_clear:all' })
      return cleared
    }
    // 按 IP 删除
    const ipList = Array.isArray(p.ips) ? p.ips.map((s) => normalizeIp(String(s))).filter(Boolean) : []
    if (ipList.length) {
      const ipSet = new Set(ipList.slice(0, 500))
      for (const [key] of this.clientTrafficByHour.entries()) {
        const parts = key.split(':')
        if (parts.length >= 2 && parts[0] === 'ip' && ipSet.has(parts[1])) {
          this.clientTrafficByHour.delete(key)
          cleared.clearedIps++
        }
      }
      for (const ip of ipSet) {
        try { this.db.prepare('DELETE FROM traffic_ip_hourly WHERE ip=?').run(ip) } catch {}
        try { this.db.prepare('DELETE FROM traffic_ip WHERE ip=?').run(ip) } catch {}
      }
    }
    // 按域名删除
    const domainList = Array.isArray(p.domains) ? p.domains.map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean) : []
    if (domainList.length) {
      const domainSet = new Set(domainList.slice(0, 500))
      for (const [key] of this.clientTrafficByHour.entries()) {
        const parts = key.split(':')
        if (parts.length >= 2 && parts[0] === 'domain' && domainSet.has(parts[1])) {
          this.clientTrafficByHour.delete(key)
          cleared.clearedDomains++
        }
      }
      for (const d of domainSet) {
        try { this.db.prepare('DELETE FROM traffic_domain_hourly WHERE domain=?').run(d) } catch {}
        try { this.db.prepare('DELETE FROM traffic_domain WHERE domain=?').run(d) } catch {}
      }
    }
    const hourList = Array.isArray(p.hours) ? p.hours.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
    const hourSet = new Set(hourList.slice(0, 2000))
    for (const b of hourSet) {
      if (this.trafficByHour.delete(b)) {
        cleared.clearedHours++
        try { this.db.prepare('DELETE FROM traffic_hourly WHERE bucket_start=?').run(b) } catch {}
        try { this.db.prepare('DELETE FROM traffic_ip_hourly WHERE bucket_start=?').run(b) } catch {}
        try { this.db.prepare('DELETE FROM traffic_domain_hourly WHERE bucket_start=?').run(b) } catch {}
        for (const [key, v] of this.clientTrafficByHour.entries()) {
          if ((v as any)?.bucketStart === b) this.clientTrafficByHour.delete(key)
        }
      }
    }
    const dayList = Array.isArray(p.days) ? p.days.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
    const daySet = new Set(dayList.slice(0, 400))
    if (daySet.size) {
      const dayMs = 24 * 60 * 60 * 1000
      for (const [bucketStart] of this.trafficByHour.entries()) {
        const dayBucket = Math.floor(bucketStart / dayMs) * dayMs
        if (!daySet.has(dayBucket)) continue
        if (this.trafficByHour.delete(bucketStart)) {
          cleared.clearedDays++
          try { this.db.prepare('DELETE FROM traffic_hourly WHERE bucket_start=?').run(bucketStart) } catch {}
          try { this.db.prepare('DELETE FROM traffic_ip_hourly WHERE bucket_start=?').run(bucketStart) } catch {}
          try { this.db.prepare('DELETE FROM traffic_domain_hourly WHERE bucket_start=?').run(bucketStart) } catch {}
          for (const [key, v] of this.clientTrafficByHour.entries()) {
            if ((v as any)?.bucketStart === bucketStart) this.clientTrafficByHour.delete(key)
          }
        }
      }
    }
    if (cleared.clearedHours || cleared.clearedDays || cleared.clearedIps || cleared.clearedDomains) {
      this.pushEvent({
        ts: now(),
        kind: 'settings_update',
        detail: `traffic_clear:hours=${cleared.clearedHours},days=${cleared.clearedDays},ips=${cleared.clearedIps},domains=${cleared.clearedDomains}`
      })
    }
    return cleared
  }

  getTraffic() {
    const s = this.getSettings()
    const enabled = !!s.traffic?.enabled
    const retentionDays = clamp(Number(s.traffic?.retentionDays ?? 30), 1, 365)
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
    const hourly: TrafficBucketStat[] = []
    for (let i = 23; i >= 0; i--) {
      const b = nowHour - i * hourMs
      const st = this.trafficByHour.get(b)
      hourly.push({ bucketStart: b, bytes: st?.bytes || 0, requests: st?.requests || 0 })
    }

    const cutoff24 = ts - 24 * hourMs
    const cutoff7 = ts - 7 * dayMs
    const cutoff30 = ts - 30 * dayMs
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

    const ipTrafficMap = new Map<string, IpTrafficStat>()
    const domainTrafficMap = new Map<string, DomainTrafficStat>()
    for (const [, st] of this.clientTrafficByHour.entries()) {
      if (!st || typeof (st as any).bucketStart !== 'number') continue
      if ((st as any).bucketStart < cutoff30) continue
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
    const topIps = Array.from(ipTrafficMap.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 50)
    const topDomains = Array.from(domainTrafficMap.values()).sort((a, b) => b.bytes - a.bytes).slice(0, 50)

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

  getEvents(limit = 120) {
    const inMem = this.events.slice(-limit)
    if (inMem.length >= Math.min(limit, 60)) return inMem
    const rows = this.db.prepare('SELECT id, ts, kind, ip, domain, path, detail FROM security_events ORDER BY ts DESC LIMIT ?').all(limit) as any[]
    return rows
      .slice()
      .reverse()
      .map((r) => ({
        id: typeof r.id === 'number' ? r.id : Number(r.id) || undefined,
        ts: Number(r.ts) || now(),
        kind: String(r.kind) as any,
        ip: r.ip != null ? String(r.ip) : undefined,
        domain: r.domain != null ? String(r.domain) : undefined,
        path: r.path != null ? String(r.path) : undefined,
        detail: r.detail != null ? String(r.detail) : undefined
      }))
  }

  async deleteEvents(ids: number[]) {
    await this.init()
    const list = Array.isArray(ids) ? ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0) : []
    if (!list.length) return { ok: true as const, deleted: 0 }
    const unique = Array.from(new Set(list)).slice(0, 500)
    const placeholders = unique.map(() => '?').join(',')
    const res = this.db.prepare(`DELETE FROM security_events WHERE id IN (${placeholders})`).run(...unique)
    const deleted = Number(res?.changes ?? 0)
    if (deleted > 0) this.events = this.events.filter((e) => !e.id || !unique.includes(e.id))
    return { ok: true as const, deleted }
  }

  async clearAllEvents() {
    await this.init()
    let deleted = 0
    try {
      const res = this.db.prepare('DELETE FROM security_events').run()
      deleted = Number(res?.changes ?? 0)
    } catch {}
    this.events = []
    return { ok: true as const, deleted }
  }

  async clearIpStats(ips: string[]) {
    await this.init()
    const list = Array.isArray(ips) ? ips.map((s) => normalizeIp(String(s))).filter(Boolean) : []
    const unique = Array.from(new Set(list)).slice(0, 200)
    for (const ip of unique) this.ipStats.delete(ip)
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: `top_ip_clear:${unique.length}` })
    return { ok: true as const, cleared: unique.length }
  }

  async clearDomainStats(domains: string[]) {
    await this.init()
    const list = Array.isArray(domains) ? domains.map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean) : []
    const unique = Array.from(new Set(list)).slice(0, 200)
    for (const d of unique) this.domainStats.delete(d)
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: `top_domain_clear:${unique.length}` })
    return { ok: true as const, cleared: unique.length }
  }

  async clearAllTopStats() {
    await this.init()
    const ips = this.ipStats.size
    const domains = this.domainStats.size
    this.ipStats.clear()
    this.domainStats.clear()
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: `top_clear:all ips=${ips},domains=${domains}` })
    return { ok: true as const, clearedIps: ips, clearedDomains: domains }
  }

  getAnnouncements(): Announcement[] {
    const rows = this.db
      .prepare('SELECT id, text, enabled, created_at, updated_at, sort_order FROM announcements ORDER BY sort_order ASC, updated_at DESC')
      .all() as any[]
    const out: Announcement[] = []
    for (const r of rows) {
      out.push({
        id: String(r.id),
        text: String(r.text),
        enabled: !!r.enabled,
        createdAt: Number(r.created_at) || now(),
        updatedAt: Number(r.updated_at) || now()
      })
    }
    return out
  }

  getAnnouncementsPublic() {
    return this.getAnnouncements()
      .filter((a) => a.enabled)
      .map((a) => ({ id: a.id, text: a.text }))
  }

  async setAnnouncements(list: { id?: string; text: string; enabled?: boolean }[]) {
    await this.init()
    const clean = Array.isArray(list) ? list : []
    const ts = now()
    const existing = new Map<string, { createdAt: number; sortOrder: number }>()
    for (const r of this.db.prepare('SELECT id, created_at, sort_order FROM announcements').all() as any[]) {
      existing.set(String(r.id), { createdAt: Number(r.created_at) || ts, sortOrder: Number(r.sort_order) || 0 })
    }
    const out: Announcement[] = []
    const seen = new Set<string>()
    let sortOrder = 0
    for (const item of clean) {
      const text = String(item?.text ?? '').trim()
      if (!text) continue
      const id = String(item?.id ?? '').trim() || (typeof crypto !== 'undefined' ? crypto.randomUUID?.() : '') || `${ts}_${sortOrder}_${Math.random()}`
      if (seen.has(id)) continue
      seen.add(id)
      const prev = existing.get(id)
      const createdAt = prev?.createdAt ?? ts
      const enabled = item?.enabled != null ? !!item.enabled : true
      out.push({ id, text, enabled, createdAt, updatedAt: ts })
      this.db
        .prepare('INSERT INTO announcements (id, text, enabled, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text, enabled=excluded.enabled, sort_order=excluded.sort_order, updated_at=excluded.updated_at')
        .run(id, text, enabled ? 1 : 0, prev?.sortOrder ?? sortOrder, createdAt, ts)
      sortOrder++
    }
    for (const id of existing.keys()) {
      if (!seen.has(id)) this.db.prepare('DELETE FROM announcements WHERE id=?').run(id)
    }
    this.pushEvent({ ts, kind: 'announcement_update', detail: `announcements=${out.length}` })
    return this.getAnnouncements()
  }

  async updateSettings(next: Partial<SecuritySettings>) {
    await this.init()
    const cur = this.getSettings()
    const prevTrafficEnabled = !!cur.traffic?.enabled
    const merged: SecuritySettings = {
      enabled: next.enabled != null ? !!next.enabled : cur.enabled,
      banSeconds:
        next.banSeconds != null ? clamp(Number(next.banSeconds), 60, 60 * 60 * 24 * 30) : clamp(cur.banSeconds, 60, 60 * 60 * 24 * 30),
      rate: {
        enabled: next.rate?.enabled != null ? !!next.rate.enabled : cur.rate.enabled,
        windowSeconds: next.rate?.windowSeconds != null ? clamp(Number(next.rate.windowSeconds), 10, 3600) : cur.rate.windowSeconds,
        maxRequests: next.rate?.maxRequests != null ? clamp(Number(next.rate.maxRequests), 10, 10000) : cur.rate.maxRequests
      },
      scan: {
        enabled: next.scan?.enabled != null ? !!next.scan.enabled : cur.scan.enabled,
        windowSeconds: next.scan?.windowSeconds != null ? clamp(Number(next.scan.windowSeconds), 10, 3600) : cur.scan.windowSeconds,
        maxHits: next.scan?.maxHits != null ? clamp(Number(next.scan.maxHits), 1, 1000) : cur.scan.maxHits
      },
      refererAbuse: {
        enabled: next.refererAbuse?.enabled != null ? !!next.refererAbuse.enabled : cur.refererAbuse.enabled,
        windowSeconds:
          next.refererAbuse?.windowSeconds != null ? clamp(Number(next.refererAbuse.windowSeconds), 10, 3600) : cur.refererAbuse.windowSeconds,
        maxRequests:
          next.refererAbuse?.maxRequests != null ? clamp(Number(next.refererAbuse.maxRequests), 10, 10000) : cur.refererAbuse.maxRequests
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
        enabled: next.traffic?.enabled != null ? !!next.traffic.enabled : cur.traffic.enabled,
        retentionDays:
          next.traffic?.retentionDays != null ? clamp(Number(next.traffic.retentionDays), 1, 365) : clamp(cur.traffic.retentionDays, 1, 365)
      }
    }
    this.db
      .prepare(
        `UPDATE security_settings SET
          enabled=?,
          ban_seconds=?,
          rate_enabled=?,
          rate_window_seconds=?,
          rate_max_requests=?,
          scan_enabled=?,
          scan_window_seconds=?,
          scan_max_hits=?,
          ref_enabled=?,
          ref_window_seconds=?,
          ref_max_requests=?,
          registration_enabled=?,
          cleanup_enabled=?,
          events_retention_days=?,
          top_retention_days=?,
          traffic_enabled=?,
          traffic_retention_days=?
        WHERE id=1`
      )
      .run(
        merged.enabled ? 1 : 0,
        merged.banSeconds,
        merged.rate.enabled ? 1 : 0,
        merged.rate.windowSeconds,
        merged.rate.maxRequests,
        merged.scan.enabled ? 1 : 0,
        merged.scan.windowSeconds,
        merged.scan.maxHits,
        merged.refererAbuse.enabled ? 1 : 0,
        merged.refererAbuse.windowSeconds,
        merged.refererAbuse.maxRequests,
        merged.registrationEnabled ? 1 : 0,
        merged.cleanup.enabled ? 1 : 0,
        merged.cleanup.eventRetentionDays,
        merged.cleanup.topRetentionDays,
        merged.traffic.enabled ? 1 : 0,
        merged.traffic.retentionDays
      )
    if (prevTrafficEnabled && !merged.traffic.enabled) this.clearTraffic({ all: true })
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: 'settings updated' })
    return merged
  }

  async updateSiteSettings(next: Partial<SiteSettings>) {
    await this.init()
    const cur = this.getSiteSettings()
    const merged: SiteSettings = {
      footerText: next.footerText != null ? String(next.footerText) : String(cur.footerText ?? ''),
      footerFormat: next.footerFormat === 'html' || next.footerFormat === 'md' ? next.footerFormat : cur.footerFormat,
      title: next.title != null ? String(next.title) : String(cur.title ?? ''),
      description: next.description != null ? String(next.description) : String(cur.description ?? ''),
      announcementFormat: next.announcementFormat === 'html' || next.announcementFormat === 'md' ? next.announcementFormat : cur.announcementFormat,
      faviconUrl: next.faviconUrl != null ? String(next.faviconUrl) : String(cur.faviconUrl ?? ''),
      logoUrl: next.logoUrl != null ? String(next.logoUrl) : String(cur.logoUrl ?? '')
    }
    this.db
      .prepare('UPDATE site_settings SET footer_text=?, footer_format=?, title=?, description=?, announcement_format=?, favicon_url=?, logo_url=? WHERE id=1')
      .run(merged.footerText, merged.footerFormat, merged.title, merged.description, merged.announcementFormat, merged.faviconUrl, merged.logoUrl)
    this.pushEvent({ ts: now(), kind: 'settings_update', detail: 'site_settings_update' })
    return merged
  }

  async removeBans(list: { type: BanType; value: string }[]) {
    await this.init()
    const input = Array.isArray(list) ? list : []
    const out: { type: BanType; value: string }[] = []
    for (const item of input) {
      const type: BanType = item?.type === 'domain' ? 'domain' : 'ip'
      const value = String(item?.value ?? '').trim().toLowerCase()
      if (!value) continue
      out.push({ type, value })
    }
    if (!out.length) return { ok: true as const, deleted: 0 }
    let deleted = 0
    for (const b of out.slice(0, 500)) {
      const res = this.db.prepare('DELETE FROM bans WHERE type=? AND value=?').run(b.type, b.value)
      deleted += Number(res?.changes ?? 0)
    }
    if (deleted > 0) this.pushEvent({ ts: now(), kind: 'settings_update', detail: `bans_delete:${deleted}` })
    return { ok: true as const, deleted }
  }

  async setSiteAsset(kind: 'favicon' | 'logo', input: { mime: string; data: Uint8Array }) {
    await this.init()
    const mime = String(input.mime ?? '').trim().toLowerCase()
    if (!mime.startsWith('image/')) return { ok: false as const, error: 'invalid_mime' as const }
    if (!(input.data instanceof Uint8Array) || input.data.byteLength <= 0) return { ok: false as const, error: 'invalid_data' as const }
    if (input.data.byteLength > 256 * 1024) return { ok: false as const, error: 'too_large' as const }
    const ts = now()
    const buf = Buffer.from(input.data)
    this.db
      .prepare('INSERT INTO site_assets (kind, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(kind) DO UPDATE SET mime=excluded.mime, data=excluded.data, updated_at=excluded.updated_at')
      .run(kind, mime, buf, ts)
    this.pushEvent({ ts, kind: 'settings_update', detail: `site_asset:${kind}` })
    return { ok: true as const }
  }

  async clearSiteAsset(kind: 'favicon' | 'logo') {
    await this.init()
    const ts = now()
    this.db.prepare('DELETE FROM site_assets WHERE kind=?').run(kind)
    this.pushEvent({ ts, kind: 'settings_update', detail: `site_asset_clear:${kind}` })
    return { ok: true as const }
  }

  async addBan(input: { type: BanType; value: string; reason?: string; seconds?: number; createdBy?: 'manual' | 'auto' }) {
    await this.init()
    const type: BanType = input.type
    const rawValue = String(input.value ?? '').trim().toLowerCase()
    if (type === 'ip' && !isProbablyIp(rawValue)) return { ok: false as const, error: 'invalid_ip' as const }
    if (type === 'domain' && !isProbablyDomain(rawValue)) return { ok: false as const, error: 'invalid_domain' as const }
    const secondsInput = typeof input.seconds === 'number' ? input.seconds : this.getSettings().banSeconds
    const expiresAt =
      typeof secondsInput === 'number' && secondsInput > 0 ? now() + clamp(Math.floor(secondsInput), 60, 60 * 60 * 24 * 30) * 1000 : undefined
    const entry: BanEntry = {
      type,
      value: rawValue,
      reason: input.reason?.trim() || undefined,
      createdAt: now(),
      createdBy: input.createdBy === 'auto' ? 'auto' : 'manual',
      expiresAt
    }
    this.db
      .prepare('INSERT INTO bans (type, value, reason, created_at, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(type, value) DO UPDATE SET reason=excluded.reason, created_at=excluded.created_at, created_by=excluded.created_by, expires_at=excluded.expires_at')
      .run(entry.type, entry.value, entry.reason ?? null, entry.createdAt, entry.createdBy, entry.expiresAt ?? null)
    this.pushEvent({
      ts: now(),
      kind: entry.createdBy === 'auto' ? 'auto_ban' : 'manual_ban',
      ip: type === 'ip' ? rawValue : undefined,
      domain: type === 'domain' ? rawValue : undefined,
      detail: entry.reason
    })
    return { ok: true as const, entry }
  }

  async removeBan(type: BanType, value: string) {
    await this.init()
    const v = String(value ?? '').trim().toLowerCase()
    const res = this.db.prepare('DELETE FROM bans WHERE type=? AND value=?').run(type, v)
    if (Number(res?.changes ?? 0) > 0) {
      this.pushEvent({ ts: now(), kind: 'unban', ip: type === 'ip' ? v : undefined, domain: type === 'domain' ? v : undefined })
    }
    return true
  }

  private isManuallyBanned(ip: string, domain: string) {
    this.cleanupExpiredBans()
    const bans = this.getBans()
    for (const b of bans) {
      if (b.type === 'ip' && ip && b.value === ip) return b
      if (b.type === 'domain' && domain && b.value === domain) return b
    }
    return null
  }

  observeStart(params: { ip: string; domain: string; path: string }) {
    const settings = this.getSettings()
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

      // 高危路径：单次命中立即封禁
      const instantHit = INSTANT_BAN_PATHS.some((p) => lowered.startsWith(p))
      if (instantHit) {
        void this.addBan({ type: 'ip', value: ip, reason: `instant_ban:${path}`, seconds: settings.banSeconds, createdBy: 'auto' })
        this.pushEvent({ ts, kind: 'blocked', ip, domain, path, detail: 'auto_instant_ban' })
        return { blocked: true as const, reason: 'scan_detected' }
      }

      // 通用扫描路径：累计命中达阈值后封禁
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
        if (ip) void this.addBan({ type: 'ip', value: ip, reason: `referer_abuse_ip:${domain}`, seconds: settings.banSeconds, createdBy: 'auto' })
        this.pushEvent({ ts, kind: 'blocked', ip, domain, path, detail: 'auto_domain_abuse' })
        return { blocked: true as const, reason: 'domain_blocked' }
      }
    }

    return { blocked: false as const }
  }

  getOverview() {
    this.maybeCleanup(now())
    const settings = this.getSettings()
    const site = this.getSiteSettings()
    const bans = this.getBans()
    const announcements = this.getAnnouncements()
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
