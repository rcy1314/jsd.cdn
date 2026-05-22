import { serve } from '@hono/node-server'
import { createNodeApp } from './app-node.js'
import { AdminDbStore } from './lib/admin-db.js'
import { AuthDb } from './lib/auth-db.js'
import { openAppDb } from './lib/db.js'

const port = Number(process.env.PORT || 5011)

const db = await openAppDb()
const adminStore = new AdminDbStore(db)
const auth = new AuthDb(db)
const app = createNodeApp({ adminStore, auth })

serve(
  {
    fetch: app.fetch,
    port
  },
  (info: { port: number }) => {
    console.log(`listening on http://localhost:${info.port}`)
  }
)
