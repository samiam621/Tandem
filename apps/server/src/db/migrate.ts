import 'dotenv/config'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { getDb } from './index.js'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = getDb()
migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') })
console.log('Migrations applied.')
