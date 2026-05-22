import type { AppDb } from './db.js'
import { buildSetCookie, parseCookie } from './admin.js'

export type UserRole = 'admin' | 'user'

export type AuthedUser = {
  id: string
  username: string
  role: UserRole
}

const now = () => Date.now()

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))

const randomId = () => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64')
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const getEnv = (key: string) => {
  try {
    if (typeof process !== 'undefined' && (process as any)?.env?.[key] != null) return String((process as any).env[key])
  } catch {}
  return undefined
}

const getJwtSecret = () => getEnv('JWT_SECRET') || getEnv('ADMIN_SECRET') || getEnv('ADMIN_PASSWORD') || 'dev-secret'

const makeCsrfToken = () => randomId() + randomId()

const hashPassword = async (password: string) => {
  const mod = await import('bcryptjs')
  const bcrypt = mod as any
  const saltRounds = 12
  return bcrypt.hash(String(password), saltRounds)
}

const verifyPassword = async (password: string, passwordHash: string) => {
  const mod = await import('bcryptjs')
  const bcrypt = mod as any
  return bcrypt.compare(String(password), String(passwordHash))
}

const signJwt = async (payload: any, expiresInSeconds: number) => {
  const mod = await import('jose')
  const { SignJWT } = mod as any
  const secret = new TextEncoder().encode(getJwtSecret())
  const issuedAt = Math.floor(now() / 1000)
  const exp = issuedAt + clamp(expiresInSeconds, 60, 60 * 60 * 24 * 30)
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt(issuedAt).setExpirationTime(exp).sign(secret)
}

const verifyJwt = async (token: string) => {
  const mod = await import('jose')
  const { jwtVerify } = mod as any
  const secret = new TextEncoder().encode(getJwtSecret())
  const r = await jwtVerify(token, secret, { algorithms: ['HS256'] })
  return r.payload as any
}

export class AuthDb {
  private readonly db: AppDb
  private ready = false

  constructor(db: AppDb) {
    this.db = db
  }

  async init() {
    if (this.ready) return
    this.ready = true
  }

  getRegistrationEnabled() {
    const row = this.db.prepare('SELECT registration_enabled as enabled FROM security_settings WHERE id=1').get()
    return !!row?.enabled
  }

  setRegistrationEnabled(enabled: boolean) {
    this.db.prepare('UPDATE security_settings SET registration_enabled=? WHERE id=1').run(enabled ? 1 : 0)
    return this.getRegistrationEnabled()
  }

  countUsers() {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM users').get()
    return Number(row?.c ?? 0) || 0
  }

  canPublicRegister() {
    return this.countUsers() === 0 || this.getRegistrationEnabled()
  }

  private findUserByUsername(username: string) {
    const u = String(username ?? '').trim().toLowerCase()
    if (!u) return null
    const row = this.db.prepare('SELECT id, username, password_hash, role FROM users WHERE username=?').get(u)
    if (!row) return null
    return { id: String(row.id), username: String(row.username), passwordHash: String(row.password_hash), role: String(row.role) as UserRole }
  }

  private findUserById(id: string) {
    const row = this.db.prepare('SELECT id, username, role FROM users WHERE id=?').get(String(id))
    if (!row) return null
    return { id: String(row.id), username: String(row.username), role: String(row.role) as UserRole }
  }

  async register(username: string, password: string) {
    await this.init()
    const u = String(username ?? '').trim().toLowerCase()
    const p = String(password ?? '')
    if (u.length < 3 || u.length > 32) return { ok: false as const, error: 'invalid_username' as const }
    if (!/^[a-z0-9._-]+$/.test(u)) return { ok: false as const, error: 'invalid_username' as const }
    if (p.length < 8 || p.length > 200) return { ok: false as const, error: 'invalid_password' as const }
    if (!this.canPublicRegister()) return { ok: false as const, error: 'registration_disabled' as const }
    if (this.findUserByUsername(u)) return { ok: false as const, error: 'username_taken' as const }
    const role: UserRole = this.countUsers() === 0 ? 'admin' : 'user'
    const id = randomId()
    const passwordHash = await hashPassword(p)
    const createdAt = now()
    this.db
      .prepare('INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, u, passwordHash, role, createdAt)
    if (role === 'admin') this.setRegistrationEnabled(false)
    return { ok: true as const, user: { id, username: u, role } }
  }

  private async createSession(userId: string, ttlSeconds: number) {
    const sessionId = randomId()
    const createdAt = now()
    const expiresAt = createdAt + clamp(ttlSeconds, 60, 60 * 60 * 24 * 30) * 1000
    this.db.prepare('INSERT INTO auth_sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sessionId, userId, createdAt, expiresAt)
    return { sessionId, expiresAt }
  }

  async login(username: string, password: string) {
    await this.init()
    const u = this.findUserByUsername(username)
    if (!u) return { ok: false as const, error: 'invalid_credentials' as const }
    const ok = await verifyPassword(password, u.passwordHash)
    if (!ok) return { ok: false as const, error: 'invalid_credentials' as const }
    const sess = await this.createSession(u.id, 60 * 60 * 24 * 7)
    const token = await signJwt({ sid: sess.sessionId, uid: u.id }, 60 * 60 * 24 * 7)
    return { ok: true as const, token, user: { id: u.id, username: u.username, role: u.role } }
  }

  async logout(req: Request) {
    await this.init()
    const cookies = parseCookie(req.headers.get('cookie'))
    const token = cookies['jsd_auth'] ?? ''
    if (!token) return false
    try {
      const payload = await verifyJwt(token)
      const sid = String(payload?.sid ?? '')
      if (!sid) return false
      this.db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(now(), sid)
      return true
    } catch {
      return false
    }
  }

  buildAuthCookies(opts: { token: string; secure: boolean }) {
    const csrf = makeCsrfToken()
    const maxAgeSeconds = 60 * 60 * 24 * 7
    const authCookie = buildSetCookie({
      name: 'jsd_auth',
      value: opts.token,
      httpOnly: true,
      sameSite: 'Strict',
      secure: opts.secure,
      path: '/',
      maxAgeSeconds
    })
    const csrfCookie = buildSetCookie({
      name: 'jsd_csrf',
      value: csrf,
      httpOnly: false,
      sameSite: 'Strict',
      secure: opts.secure,
      path: '/',
      maxAgeSeconds
    })
    return { authCookie, csrfCookie, csrf }
  }

  buildLogoutCookies(opts: { secure: boolean }) {
    const authCookie = buildSetCookie({ name: 'jsd_auth', value: '', httpOnly: true, sameSite: 'Strict', secure: opts.secure, path: '/', maxAgeSeconds: 0 })
    const csrfCookie = buildSetCookie({ name: 'jsd_csrf', value: '', httpOnly: false, sameSite: 'Strict', secure: opts.secure, path: '/', maxAgeSeconds: 0 })
    return { authCookie, csrfCookie }
  }

  async verify(req: Request): Promise<AuthedUser | null> {
    await this.init()
    const cookies = parseCookie(req.headers.get('cookie'))
    const token = cookies['jsd_auth'] ?? ''
    if (!token) return null
    try {
      const payload = await verifyJwt(token)
      const sid = String(payload?.sid ?? '')
      const uid = String(payload?.uid ?? '')
      if (!sid || !uid) return null
      const row = this.db.prepare('SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE id=?').get(sid)
      if (!row) return null
      if (row.revoked_at != null) return null
      if (Number(row.expires_at ?? 0) <= now()) return null
      if (String(row.user_id) !== uid) return null
      const u = this.findUserById(uid)
      return u
    } catch {
      return null
    }
  }
}

