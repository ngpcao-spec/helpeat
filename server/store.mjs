import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { initialTimes } from '../public/time.mjs'

export const token = () => randomBytes(32).toString('base64url')
const digest = value => createHash('sha256').update(value).digest('hex')

export function createStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, preferences TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meals (
      account TEXT NOT NULL REFERENCES accounts(id), day TEXT NOT NULL, slot TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('confirmed','planned')), dishes TEXT NOT NULL,
      PRIMARY KEY (account, day, slot)
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id), subscription TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS push_deliveries (
      endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
      day TEXT NOT NULL, slot TEXT NOT NULL, claimed_at INTEGER NOT NULL, sent INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (endpoint, day, slot)
    );
  `)
  const run = (sql, ...params) => db.prepare(sql).run(...params)
  const get = (sql, ...params) => db.prepare(sql).get(...params)
  const all = (sql, ...params) => db.prepare(sql).all(...params)
  const defaults = JSON.stringify({ locale: 'vi', zone: '', notify: false, times: initialTimes })
  const toMeal = row => ({ date: row.day, meal: row.slot, status: row.status, dishes: JSON.parse(row.dishes) })

  return {
    close: () => db.close(),
    signIn(id, name, previous) {
      run('insert into accounts values (?, ?, ?) on conflict(id) do update set name = excluded.name', id, name, defaults)
      run('delete from sessions where expires <= ?', Date.now())
      if (previous) run('delete from sessions where hash = ?', digest(previous))
      const session = token()
      run('insert into sessions values (?, ?, ?)', digest(session), id, Date.now() + 30 * 86_400_000)
      return session
    },
    signOut(value) {
      run('delete from sessions where hash = ?', digest(value))
    },
    account(value) {
      if (!value) return null
      const row = get(`select a.* from accounts a join sessions s on a.id = s.account
        where s.hash = ? and s.expires > ?`, digest(value), Date.now())
      return row ? { id: row.id, name: row.name, preferences: JSON.parse(row.preferences) } : null
    },
    savePreferences(id, preferences) {
      run('update accounts set preferences = ? where id = ?', JSON.stringify(preferences), id)
    },
    meals(id, since = '', limit = 366, before = '9999-12-31') {
      return all('select * from meals where account = ? and day >= ? and day < ? order by day desc, slot limit ?',
        id, since, before, limit).map(toMeal)
    },
    meal(id, date, slot) {
      const row = get('select * from meals where account = ? and day = ? and slot = ?', id, date, slot)
      return row && toMeal(row)
    },
    saveMeal(id, entry, protectConfirmed) {
      const condition = protectConfirmed ? "where meals.status <> 'confirmed'" : ''
      return run(`insert into meals values (?, ?, ?, ?, ?) on conflict (account, day, slot)
        do update set status = excluded.status, dishes = excluded.dishes ${condition}`,
      id, entry.date, entry.meal, entry.status, JSON.stringify(entry.dishes)).changes > 0
    },
    deleteMeal(id, date, slot, plannedOnly = false) {
      const query = 'delete from meals where account = ? and day = ? and slot = ?'
      run(plannedOnly ? query + " and status = 'planned'" : query, id, date, slot)
    },
    subscribe(id, subscription) {
      run(`insert into push_subscriptions values (?, ?, ?) on conflict (endpoint)
        do update set account = excluded.account, subscription = excluded.subscription`,
      subscription.endpoint, id, JSON.stringify(subscription))
    },
    unsubscribe(id, endpoint) {
      run('delete from push_subscriptions where account = ? and endpoint = ?', id, endpoint)
    },
    preferencesForPush() {
      return all(`select s.*, a.preferences from push_subscriptions s
        join accounts a on a.id = s.account where json_extract(a.preferences, '$.notify') = 1`)
        .map(row => ({ ...row, subscription: JSON.parse(row.subscription), preferences: JSON.parse(row.preferences) }))
    },
    claimPush(endpoint, day, slot, now) {
      return run(`insert into push_deliveries values (?, ?, ?, ?, 0) on conflict(endpoint, day, slot)
        do update set claimed_at = excluded.claimed_at
        where sent = 0 and claimed_at < ?`, endpoint, day, slot, now, now - 120_000).changes > 0
    },
    markPush(endpoint, day, slot) {
      run('update push_deliveries set sent = 1 where endpoint = ? and day = ? and slot = ?', endpoint, day, slot)
    },
    prunePush(day) {
      run('delete from push_deliveries where day < ?', day)
    },
  }
}
