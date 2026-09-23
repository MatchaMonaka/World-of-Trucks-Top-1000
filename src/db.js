'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'players.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  country_code          TEXT,
  country_name          TEXT,

  global_distance_km    REAL DEFAULT 0,
  global_jobs           INTEGER DEFAULT 0,
  global_mass_t         REAL DEFAULT 0,
  global_time_min       INTEGER DEFAULT 0,
  global_avg_distance_km REAL DEFAULT 0,
  global_avg_speed_kmh  REAL DEFAULT 0,

  euro_distance_km      REAL DEFAULT 0,
  euro_jobs             INTEGER DEFAULT 0,
  euro_mass_t           REAL DEFAULT 0,
  euro_time_min         INTEGER DEFAULT 0,
  euro_avg_distance_km  REAL DEFAULT 0,
  euro_avg_speed_kmh    REAL DEFAULT 0,

  american_distance_km  REAL DEFAULT 0,
  american_jobs         INTEGER DEFAULT 0,
  american_mass_t       REAL DEFAULT 0,
  american_time_min     INTEGER DEFAULT 0,
  american_avg_distance_km REAL DEFAULT 0,
  american_avg_speed_kmh   REAL DEFAULT 0,

  created_at            INTEGER NOT NULL,
  last_updated          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_global_distance ON players (global_distance_km DESC);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

// ---- meta helpers (used for the "new player" global 5-min rate limit) ----
function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

// ---- player helpers ----
function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

function upsertPlayer(parsed) {
  const now = Date.now();
  const existing = getPlayer(parsed.id);
  const createdAt = existing ? existing.created_at : now;

  db.prepare(
    `INSERT INTO players (
      id, name, country_code, country_name,
      global_distance_km, global_jobs, global_mass_t, global_time_min, global_avg_distance_km, global_avg_speed_kmh,
      euro_distance_km, euro_jobs, euro_mass_t, euro_time_min, euro_avg_distance_km, euro_avg_speed_kmh,
      american_distance_km, american_jobs, american_mass_t, american_time_min, american_avg_distance_km, american_avg_speed_kmh,
      created_at, last_updated
    ) VALUES (
      @id, @name, @country_code, @country_name,
      @g_dist, @g_jobs, @g_mass, @g_time, @g_avgd, @g_avgs,
      @e_dist, @e_jobs, @e_mass, @e_time, @e_avgd, @e_avgs,
      @a_dist, @a_jobs, @a_mass, @a_time, @a_avgd, @a_avgs,
      @created_at, @last_updated
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      country_code = excluded.country_code,
      country_name = excluded.country_name,
      global_distance_km = excluded.global_distance_km,
      global_jobs = excluded.global_jobs,
      global_mass_t = excluded.global_mass_t,
      global_time_min = excluded.global_time_min,
      global_avg_distance_km = excluded.global_avg_distance_km,
      global_avg_speed_kmh = excluded.global_avg_speed_kmh,
      euro_distance_km = excluded.euro_distance_km,
      euro_jobs = excluded.euro_jobs,
      euro_mass_t = excluded.euro_mass_t,
      euro_time_min = excluded.euro_time_min,
      euro_avg_distance_km = excluded.euro_avg_distance_km,
      euro_avg_speed_kmh = excluded.euro_avg_speed_kmh,
      american_distance_km = excluded.american_distance_km,
      american_jobs = excluded.american_jobs,
      american_mass_t = excluded.american_mass_t,
      american_time_min = excluded.american_time_min,
      american_avg_distance_km = excluded.american_avg_distance_km,
      american_avg_speed_kmh = excluded.american_avg_speed_kmh,
      last_updated = excluded.last_updated
    `
  ).run({
    id: parsed.id,
    name: parsed.name,
    country_code: parsed.country_code,
    country_name: parsed.country_name,
    g_dist: parsed.global.distance_km,
    g_jobs: parsed.global.jobs,
    g_mass: parsed.global.mass_t,
    g_time: parsed.global.time_min,
    g_avgd: parsed.global.avg_distance_km,
    g_avgs: parsed.global.avg_speed_kmh,
    e_dist: parsed.euro.distance_km,
    e_jobs: parsed.euro.jobs,
    e_mass: parsed.euro.mass_t,
    e_time: parsed.euro.time_min,
    e_avgd: parsed.euro.avg_distance_km,
    e_avgs: parsed.euro.avg_speed_kmh,
    a_dist: parsed.american.distance_km,
    a_jobs: parsed.american.jobs,
    a_mass: parsed.american.mass_t,
    a_time: parsed.american.time_min,
    a_avgd: parsed.american.avg_distance_km,
    a_avgs: parsed.american.avg_speed_kmh,
    created_at: createdAt,
    last_updated: now,
  });

  return getPlayer(parsed.id);
}

/**
 * Top N players ranked strictly by global_distance_km, descending.
 * Anyone who doesn't make this cut is excluded entirely, regardless of
 * how they rank in Euro/American stats.
 */
function getLeaderboard(limit = 1000) {
  return db
    .prepare(
      `SELECT * FROM players
       WHERE global_distance_km > 0
       ORDER BY global_distance_km DESC
       LIMIT ?`
    )
    .all(limit);
}

module.exports = {
  db,
  getMeta,
  setMeta,
  getPlayer,
  upsertPlayer,
  getLeaderboard,
};
