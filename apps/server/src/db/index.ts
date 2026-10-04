import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import * as schema from './schema.js'

let _db: ReturnType<typeof drizzleSqlite<typeof schema>> | null = null

export function getDb() {
  if (_db) return _db
  const url = process.env.DATABASE_URL ?? 'file:./tandem.db'
  // Strip "file:" prefix if present for better-sqlite3
  const file = url.startsWith('file:') ? url.slice(5) : url
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  _db = drizzleSqlite(sqlite, { schema })
  return _db
}

export type Db = ReturnType<typeof getDb>
