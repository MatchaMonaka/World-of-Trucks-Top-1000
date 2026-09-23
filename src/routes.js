'use strict';

const express = require('express');
const { fetchProfile, ScrapeError } = require('./scraper');
const { getPlayer, upsertPlayer, getLeaderboard, getMeta, setMeta } = require('./db');
const { warmFlag } = require('./flags');

const router = express.Router();

const PLAYER_REFRESH_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours
const NEW_PLAYER_COOLDOWN_MS = 0.1 * 60 * 1000; // 1 minutes
const NEW_PLAYER_META_KEY = 'last_new_player_added_at';
const MAX_LEADERBOARD_SIZE = 1000;
const MAX_VALID_ID = 999_999_999_999;

function isValidId(id) {
  return Number.isInteger(id) && id > 0 && id <= MAX_VALID_ID;
}

let newPlayerLockUntil = 0;
const refreshInFlight = new Set();

function toRankedRow(row, rank) {
  return {
    rank,
    id: Number(row.id), // PostgreSQLのBIGINTは文字列で返ることがあるため数値化
    name: row.name,
    country_code: row.country_code,
    country_name: row.country_name,
    last_updated: Number(row.last_updated),
    modes: {
      global: {
        distance_km: Number(row.global_distance_km),
        jobs: Number(row.global_jobs),
        mass_t: Number(row.global_mass_t),
        time_min: Number(row.global_time_min),
        avg_distance_km: Number(row.global_avg_distance_km),
        avg_speed_kmh: Number(row.global_avg_speed_kmh),
      },
      euro: {
        distance_km: Number(row.euro_distance_km),
        jobs: Number(row.euro_jobs),
        mass_t: Number(row.euro_mass_t),
        time_min: Number(row.euro_time_min),
        avg_distance_km: Number(row.euro_avg_distance_km),
        avg_speed_kmh: Number(row.euro_avg_speed_kmh),
      },
      american: {
        distance_km: Number(row.american_distance_km),
        jobs: Number(row.american_jobs),
        mass_t: Number(row.american_mass_t),
        time_min: Number(row.american_time_min),
        avg_distance_km: Number(row.american_avg_distance_km),
        avg_speed_kmh: Number(row.american_avg_speed_kmh),
      },
    },
  };
}

// GET /api/leaderboard -> async 化 & await getLeaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const rows = await getLeaderboard(MAX_LEADERBOARD_SIZE);
    const data = rows.map((row, i) => toRankedRow(row, i + 1));
    res.json({ count: data.length, players: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

// GET /api/players/:id -> async 化 & await getPlayer
router.get('/players/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  try {
    const row = await getPlayer(id);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(toRankedRow(row, null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch player.' });
  }
});

// POST /api/players -> 各DB操作に await 追加
router.post('/players', async (req, res) => {
  const id = Number(req.body && req.body.id);
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'A valid numeric World of Trucks profile id is required.' });
  }

  try {
    const existing = await getPlayer(id);
    if (existing) {
      return res.status(409).json({
        error: 'This player is already registered. Use the refresh action to update their stats instead.',
        id,
      });
    }

    const now = Date.now();
    const persistedLastAdded = Number((await getMeta(NEW_PLAYER_META_KEY)) || 0);
    const effectiveLastAdded = Math.max(persistedLastAdded, newPlayerLockUntil);
    const elapsed = now - effectiveLastAdded;
    if (elapsed < NEW_PLAYER_COOLDOWN_MS) {
      const waitMs = NEW_PLAYER_COOLDOWN_MS - elapsed;
      return res.status(429).json({
        error: 'New-player registration is limited to once every minute (site-friendliness limit). Please try again shortly.',
        retry_after_ms: waitMs,
      });
    }

    newPlayerLockUntil = now;

    try {
      const parsed = await fetchProfile(id);
      await setMeta(NEW_PLAYER_META_KEY, now);
      const row = await upsertPlayer(parsed);
      warmFlag(row.country_code);
      return res.status(201).json(toRankedRow(row, null));
    } catch (err) {
      await setMeta(NEW_PLAYER_META_KEY, now);
      return handleScrapeError(res, err);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

// POST /api/players/:id/refresh -> 各DB操作に await 追加
router.post('/players/:id/refresh', async (req, res) => {
  const id = Number(req.params.id);
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  try {
    const existing = await getPlayer(id);
    if (!existing) {
      return res.status(404).json({
        error: 'This player is not registered yet. Add them first.',
      });
    }

    if (refreshInFlight.has(id)) {
      return res.status(429).json({
        error: 'A refresh for this player is already in progress.',
      });
    }

    const now = Date.now();
    const elapsed = now - Number(existing.last_updated);
    if (elapsed < PLAYER_REFRESH_COOLDOWN_MS) {
      const waitMs = PLAYER_REFRESH_COOLDOWN_MS - elapsed;
      return res.status(429).json({
        error: 'This player was updated recently. Each player can only be refreshed once every 8 hours.',
        retry_after_ms: waitMs,
        next_allowed_at: Number(existing.last_updated) + PLAYER_REFRESH_COOLDOWN_MS,
      });
    }

    refreshInFlight.add(id);
    try {
      const parsed = await fetchProfile(id);
      const row = await upsertPlayer(parsed);
      warmFlag(row.country_code);
      return res.json(toRankedRow(row, null));
    } catch (err) {
      return handleScrapeError(res, err);
    } finally {
      refreshInFlight.delete(id);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

function handleScrapeError(res, err) {
  if (err instanceof ScrapeError) {
    const status = err.code === 'NOT_FOUND' ? 404 : 502;
    return res.status(status).json({ error: err.message, code: err.code });
  }
  console.error(err);
  return res.status(500).json({ error: 'Unexpected server error.' });
}

module.exports = router;