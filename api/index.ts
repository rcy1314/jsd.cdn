import { createNodeApp } from '../src/app-node.js'
import { AdminDbStore } from '../src/lib/admin-db.js'
import { AuthDb } from '../src/lib/auth-db.js'
import { openAppDb } from '../src/lib/db.js'

const db = await openAppDb()
const adminStore = new AdminDbStore(db)
const auth = new AuthDb(db)
const app = createNodeApp({ adminStore, auth })

export default function handler(req: Request): Response | Promise<Response> {
  return app.fetch(req)
}
