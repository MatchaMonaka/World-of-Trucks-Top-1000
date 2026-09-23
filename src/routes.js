'use strict';

const express = require('express');
const { fetchProfile, ScrapeError } = require('./scraper');
const { getPlayer, upsertPlayer, getLeaderboard, getMeta, setMeta } = require('./db');
const { warmFlag } = require('./flags');

const router = express.Router();

const PLAYER_REFRESH_COOLDOWN_MS = 8 * 60 * 60 * 1000; // 8 hours
const NEW_PLAYER_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const NEW_PLAYER_META_KEY = 'last_new_player_added_at';
const MAX_LEADERBOARD_SIZE = 1000;
// World of Trucks profile ids are far smaller than this in practice; this just
// keeps `id` a sane, unambiguous integer (well under Number.MAX_SAFE_INTEGER)
// rather than accepting arbitrarily huge numeric strings.
const MAX_VALID_ID = 999_999_999_999;

function isValidId(id) {
  return Number.isInteger(id) && id > 0 && id <= MAX_VALID_ID;
}

// ---- in-memory locks to close TOCTOU races around the rate-limit checks ----
// (multiple requests can arrive while the previous one is still awaiting the
// network fetch; without these, two concurrent requests could both pass the
// "am I allowed?" check before either one's result is recorded.)
let newPlayerLockUntil = 0; // reserved slot, set BEFORE the fetch even starts
const refreshInFlight = new Set(); // player ids currently being refreshed

function toRankedRow(row, rank) {
  return {
    rank,
    id: row.id,
    name: row.name,
    country_code: row.country_code,
    country_name: row.country_name,
    last_updated: row.last_updated,
    modes: {
      global: {
        distance_km: row.global_distance_km,
        jobs: row.global_jobs,
        mass_t: row.global_mass_t,
        time_min: row.global_time_min,
        avg_distance_km: row.global_avg_distance_km,
        avg_speed_kmh: row.global_avg_speed_kmh,
      },
      euro: {
        distance_km: row.euro_distance_km,
        jobs: row.euro_jobs,
        mass_t: row.euro_mass_t,
        time_min: row.euro_time_min,
        avg_distance_km: row.euro_avg_distance_km,
        avg_speed_kmh: row.euro_avg_speed_kmh,
      },
      american: {
        distance_km: row.american_distance_km,
        jobs: row.american_jobs,
        mass_t: row.american_mass_t,
        time_min: row.american_time_min,
        avg_distance_km: row.american_avg_distance_km,
        avg_speed_kmh: row.american_avg_speed_kmh,
      },
    },
  };
}

// GET /api/leaderboard  -> top 1000 by Global Total Distance (fixed population)
router.get('/leaderboard', (req, res) => {
  const rows = getLeaderboard(MAX_LEADERBOARD_SIZE);
  const data = rows.map((row, i) => toRankedRow(row, i + 1));
  res.json({ count: data.length, players: data });
});

// GET /api/players/:id -> single player (for direct lookup, debugging, etc.)
router.get('/players/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const row = getPlayer(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(toRankedRow(row, null));
});

// POST /api/players  { id }  -> register a brand-new player (rate limited: 1 / 5min globally)
router.post('/players', async (req, res) => {
  const id = Number(req.body && req.body.id);
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'A valid numeric World of Trucks profile id is required.' });
  }

  const existing = getPlayer(id);
  if (existing) {
    return res.status(409).json({
      error: 'This player is already registered. Use the refresh action to update their stats instead.',
      id,
    });
  }

  const now = Date.now();
  const persistedLastAdded = Number(getMeta(NEW_PLAYER_META_KEY) || 0);
  const effectiveLastAdded = Math.max(persistedLastAdded, newPlayerLockUntil);
  const elapsed = now - effectiveLastAdded;
  if (elapsed < NEW_PLAYER_COOLDOWN_MS) {
    const waitMs = NEW_PLAYER_COOLDOWN_MS - elapsed;
    return res.status(429).json({
      error: 'New-player registration is limited to once every 5 minutes (site-friendliness limit). Please try again shortly.',
      retry_after_ms: waitMs,
    });
  }

  // Reserve the slot immediately (before the network call). This closes the
  // race window AND means a burst of concurrent/failing attempts can't be
  // used to hammer worldoftrucks.com faster than once per 5 minutes.
  newPlayerLockUntil = now;

  try {
    const parsed = await fetchProfile(id);
    setMeta(NEW_PLAYER_META_KEY, now); // persist the reservation
    const row = upsertPlayer(parsed);
    warmFlag(row.country_code);
    return res.status(201).json(toRankedRow(row, null));
  } catch (err) {
    setMeta(NEW_PLAYER_META_KEY, now); // still persist - a failed attempt also consumed the slot
    return handleScrapeError(res, err);
  }
});

// POST /api/players/:id/refresh -> re-scrape an existing player (rate limited: 1 / 8h per player)
router.post('/players/:id/refresh', async (req, res) => {
  const id = Number(req.params.id);
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const existing = getPlayer(id);
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
  const elapsed = now - existing.last_updated;
  if (elapsed < PLAYER_REFRESH_COOLDOWN_MS) {
    const waitMs = PLAYER_REFRESH_COOLDOWN_MS - elapsed;
    return res.status(429).json({
      error: 'This player was updated recently. Each player can only be refreshed once every 8 hours.',
      retry_after_ms: waitMs,
      next_allowed_at: existing.last_updated + PLAYER_REFRESH_COOLDOWN_MS,
    });
  }

  refreshInFlight.add(id);
  try {
    const parsed = await fetchProfile(id);
    const row = upsertPlayer(parsed);
    warmFlag(row.country_code);
    return res.json(toRankedRow(row, null));
  } catch (err) {
    return handleScrapeError(res, err);
  } finally {
    refreshInFlight.delete(id);
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
