import express from 'express'
import logger from 'morgan'
import dotenv from 'dotenv'
import { createClient } from '@libsql/client'

import { Server } from 'socket.io'
import { createServer } from 'node:http'

import path from 'path'
import { fileURLToPath } from 'node:url'

dotenv.config()

const port = process.env.PORT ?? 3000

const app = express()
const server = createServer(app)
const io = new Server(server, {
  connectionStateRecovery: {}
})

// dirname en módule ES
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.static(path.join(__dirname, '../client')))
app.use('/favicon.ico', express.static(path.join(__dirname, '../client/img/favicon.ico')))

// Conexión a la base de datos
const db = createClient({
  url: 'libsql://busy-vixen-jhonmasg.turso.io',
  authToken: process.env.DB_TOKEN
})

// CREACION DE LA BD
async function setupDatabase () {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT,
      user TEXT,
      avatar TEXT
    )
  `)
}
// Init db
await setupDatabase()

io.on('connection', async (socket) => {
  console.log('a user has connected!')

  socket.on('disconnect', () => {
    console.log('an user has disconnected')
  })

  socket.on('chat message', async (msg) => {
    let result
    const username = socket.handshake.auth.username ?? 'anonymous'
    const avatar = socket.handshake.auth.avatar ?? 'https://robohash.org/default.png'
    // console.log({ username })
    try {
      result = await db.execute({
        sql: 'INSERT INTO messages (content, user, avatar) VALUES (:msg, :username, :avatar)',
        args: { msg, username, avatar }
      })
    } catch (e) {
      console.error(e)
      return
    }

    io.emit('chat message', msg, result.lastInsertRowid.toString(), username, avatar)
  })

  socket.on('clearChat', async () => {
    await db.execute('DELETE FROM messages')
    io.emit('chatCleared')
  })

  if (!socket.recovered) { // <- recuperase los mensajes sin conexión
    try {
      const results = await db.execute({
        sql: 'SELECT id, content, user, avatar FROM messages WHERE id > ?',
        args: [socket.handshake.auth.serverOffset ?? 0]
      })

      results.rows.forEach(row => {
        socket.emit('chat message', row.content, row.id.toString(), row.user, row.avatar)
      })
    } catch (e) {
      console.error(e)
    }
  }
})

app.use(logger('dev'))

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/client/index.html')
})

server.listen(port, () => {
  console.log(`Server running on port ${port}`)
})
