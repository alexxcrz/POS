import cors from 'cors'
import Database from 'better-sqlite3'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dataDir = path.join(__dirname, 'data')

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const stateKeys = [
  'users',
  'products',
  'sales',
  'cuts',
  'cashBox',
  'suppliers',
  'purchaseOrders',
  'ticketSettings',
]

const stores = Object.fromEntries(
  stateKeys.map((key) => {
    const dbPath = path.join(dataDir, `${key}.sqlite`)
    const db = new Database(dbPath)
    db.prepare(
      `CREATE TABLE IF NOT EXISTS state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json_data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ).run()

    return [
      key,
      {
        dbPath,
        readStmt: db.prepare('SELECT json_data, updated_at FROM state WHERE id = 1'),
        upsertStmt: db.prepare(
          `INSERT INTO state (id, json_data, updated_at)
           VALUES (1, @json_data, @updated_at)
           ON CONFLICT(id) DO UPDATE SET
             json_data = excluded.json_data,
             updated_at = excluded.updated_at`,
        ),
      },
    ]
  }),
)

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.get('/api/health', (_req, res) => {
  const dbFiles = Object.fromEntries(
    Object.entries(stores).map(([key, store]) => [key, store.dbPath]),
  )
  res.json({ ok: true, dbFiles })
})

app.get('/api/state', (_req, res) => {
  const state = {}
  let latestUpdate = null

  for (const [key, store] of Object.entries(stores)) {
    const row = store.readStmt.get()
    if (!row) continue

    try {
      state[key] = JSON.parse(row.json_data)
      if (!latestUpdate || row.updated_at > latestUpdate) {
        latestUpdate = row.updated_at
      }
    } catch {
      state[key] = null
    }
  }

  res.json({
    state: Object.keys(state).length > 0 ? state : null,
    updatedAt: latestUpdate,
  })
})

app.put('/api/state', (req, res) => {
  const payload = req.body
  if (!payload || typeof payload !== 'object' || typeof payload.state !== 'object') {
    res.status(400).json({ error: 'Payload invalido. Se esperaba { state: {...} }.' })
    return
  }

  const updatedAt = new Date().toISOString()

  for (const [key, value] of Object.entries(payload.state)) {
    const store = stores[key]
    if (!store) continue

    store.upsertStmt.run({
      json_data: JSON.stringify(value),
      updated_at: updatedAt,
    })
  }

  res.json({ ok: true, updatedAt })
})

const port = Number(process.env.PORT || 8787)
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`POS backend escuchando en http://localhost:${port}`)
})
