'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  family: 4
});

// 接続確認テスト
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error acquiring client for PostgreSQL:', err.stack);
  } else {
    console.log('Successfully connected to PostgreSQL (Supabase)');
    release();
  }
});

// ---- meta helpers ----
async function getMeta(key) {
  const res = await pool.query('SELECT value FROM meta WHERE key = $1', [key]);
  return res.rows.length > 0 ? res.rows[0].value : null;
}

async function setMeta(key, value) {
  const query = `
    INSERT INTO meta (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  `;
  await pool.query(query, [key, String(value)]);
}

// ---- player helpers ----
async function getPlayer(id) {
  const res = await pool.query('SELECT * FROM players WHERE id = $1', [id]);
  return res.rows.length > 0 ? res.rows[0] : null;
}

async function upsertPlayer(parsed) {
  const now = Date.now();
  const existing = await getPlayer(parsed.id);
  const createdAt = existing ? existing.created_at : now;

  const query = `
    INSERT INTO players (
      id, name, country_code, country_name,
      global_distance_km, global_jobs, global_mass_t, global_time_min, global_avg_distance_km, global_avg_speed_kmh,
      euro_distance_km, euro_jobs, euro_mass_t, euro_time_min, euro_avg_distance_km, euro_avg_speed_kmh,
      american_distance_km, american_jobs, american_mass_t, american_time_min, american_avg_distance_km, american_avg_speed_kmh,
      created_at, last_updated
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22,
      $23, $24
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      country_code = EXCLUDED.country_code,
      country_name = EXCLUDED.country_name,
      global_distance_km = EXCLUDED.global_distance_km,
      global_jobs = EXCLUDED.global_jobs,
      global_mass_t = EXCLUDED.global_mass_t,
      global_time_min = EXCLUDED.global_time_min,
      global_avg_distance_km = EXCLUDED.global_avg_distance_km,
      global_avg_speed_kmh = EXCLUDED.global_avg_speed_kmh,
      euro_distance_km = EXCLUDED.euro_distance_km,
      euro_jobs = EXCLUDED.euro_jobs,
      euro_mass_t = EXCLUDED.euro_mass_t,
      euro_time_min = EXCLUDED.euro_time_min,
      euro_avg_distance_km = EXCLUDED.euro_avg_distance_km,
      euro_avg_speed_kmh = EXCLUDED.euro_avg_speed_kmh,
      american_distance_km = EXCLUDED.american_distance_km,
      american_jobs = EXCLUDED.american_jobs,
      american_mass_t = EXCLUDED.american_mass_t,
      american_time_min = EXCLUDED.american_time_min,
      american_avg_distance_km = EXCLUDED.american_avg_distance_km,
      american_avg_speed_kmh = EXCLUDED.american_avg_speed_kmh,
      last_updated = EXCLUDED.last_updated;
  `;

  const values = [
    parsed.id,
    parsed.name,
    parsed.country_code,
    parsed.country_name,
    parsed.global.distance_km,
    parsed.global.jobs,
    parsed.global.mass_t,
    parsed.global.time_min,
    parsed.global.avg_distance_km,
    parsed.global.avg_speed_kmh,
    parsed.euro.distance_km,
    parsed.euro.jobs,
    parsed.euro.mass_t,
    parsed.euro.time_min,
    parsed.euro.avg_distance_km,
    parsed.euro.avg_speed_kmh,
    parsed.american.distance_km,
    parsed.american.jobs,
    parsed.american.mass_t,
    parsed.american.time_min,
    parsed.american.avg_distance_km,
    parsed.american.avg_speed_kmh,
    createdAt,
    now,
  ];

  await pool.query(query, values);
  return getPlayer(parsed.id);
}

/**
 * Top N players ranked strictly by global_distance_km, descending.
 */
async function getLeaderboard(limit = 1000) {
  const res = await pool.query(
    `SELECT * FROM players
     WHERE global_distance_km > 0
     ORDER BY global_distance_km DESC
     LIMIT $1`,
    [limit]
  );
  return res.rows;
}

module.exports = {
  pool,
  getMeta,
  setMeta,
  getPlayer,
  upsertPlayer,
  getLeaderboard,
};