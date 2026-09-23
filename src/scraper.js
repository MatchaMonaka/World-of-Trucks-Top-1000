'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const {
  parseIntSafe,
  parseDistanceToKm,
  parseMassToTonnes,
  parseTimeToMinutes,
  parseCountryCode,
} = require('./parse');

const PROFILE_URL = (id) => `https://www.worldoftrucks.com/en/profile/${id}`;

/**
 * Helper: get the n-th (1-indexed) child of `el` matching `tag`,
 * mirroring an XPath step like /tag[n].
 */
function nth($, el, tag, n) {
  return el.children(tag).eq(n - 1);
}

class ScrapeError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ScrapeError';
    this.code = code || 'SCRAPE_ERROR';
  }
}

/**
 * Fetches https://www.worldoftrucks.com/en/profile/{id} and extracts
 * player name, country code, and Global / Euro / American stats.
 *
 * DOM map (as supplied / verified against the live page structure):
 *   /html/body/div[1]/div/div[2]/h2/a[1]            -> player name
 *   /html/body/div[1]/div/div[2]/h2/a[2]/img[@src]  -> country flag ("/img/flags/xxx.png")
 *   /html/body/div[1]/div/div[7]                    -> "Full Statistics" block
 *     ./div[2]  Jobs accomplished   -> ./div[2]=Euro ./div[3]=American ./div[4]=Global
 *     ./div[3]  Time on duty        -> same column layout
 *     ./div[4]  Total mass          -> same column layout
 *     ./div[7]  Total distance      -> same column layout
 */
async function fetchProfile(id) {
  const url = PROFILE_URL(id);
  let html;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      maxRedirects: 3,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; WoT-LeaderboardBot/1.0; +https://github.com/)',
        Accept: 'text/html,application/xhtml+xml',
      },
      validateStatus: (s) => s === 200 || s === 404,
    });
    if (res.status === 404) {
      throw new ScrapeError(`Profile ${id} not found (404)`, 'NOT_FOUND');
    }
    html = res.data;
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    throw new ScrapeError(
      `Failed to fetch profile ${id}: ${err.message}`,
      'FETCH_FAILED'
    );
  }

  const $ = cheerio.load(html);
  const body = $('body');

  const div1 = nth($, body, 'div', 1);
  const div1_div = nth($, div1, 'div', 1);

  // ---- name / country ----
  const headerBlock = nth($, div1_div, 'div', 2);
  const h2 = nth($, headerBlock, 'h2', 1);
  const nameLink = nth($, h2, 'a', 1);
  const countryLink = nth($, h2, 'a', 2);
  const flagImg = nth($, countryLink, 'img', 1);

  const name = nameLink.text().trim();
  const countryCode = parseCountryCode(flagImg.attr('src'));
  const countryName = flagImg.attr('title') || flagImg.attr('alt') || null;

  if (!name) {
    throw new ScrapeError(
      `Could not parse player name for id ${id} - page layout may have changed`,
      'PARSE_FAILED'
    );
  }

  // ---- Full Statistics block ----
  const statsRoot = nth($, div1_div, 'div', 7);
  const jobsRow = nth($, statsRoot, 'div', 2);
  const timeRow = nth($, statsRoot, 'div', 3);
  const massRow = nth($, statsRoot, 'div', 4);
  const distRow = nth($, statsRoot, 'div', 7);

  const cell = (row, n) => nth($, row, 'div', n).text().trim();

  const raw = {
    global: {
      jobs: cell(jobsRow, 4),
      time: cell(timeRow, 4),
      mass: cell(massRow, 4),
      dist: cell(distRow, 4),
    },
    euro: {
      jobs: cell(jobsRow, 2),
      time: cell(timeRow, 2),
      mass: cell(massRow, 2),
      dist: cell(distRow, 2),
    },
    american: {
      jobs: cell(jobsRow, 3),
      time: cell(timeRow, 3),
      mass: cell(massRow, 3),
      dist: cell(distRow, 3),
    },
  };

  function buildMode(m) {
    const distance_km = parseDistanceToKm(m.dist);
    const jobs = parseIntSafe(m.jobs);
    const mass_t = parseMassToTonnes(m.mass);
    const time_min = parseTimeToMinutes(m.time);
    const avg_distance_km = jobs > 0 ? Math.round((distance_km / jobs) * 10) / 10 : 0;
    const avg_speed_kmh =
      time_min > 0 ? Math.round((distance_km / (time_min / 60)) * 10) / 10 : 0;
    return { distance_km, jobs, mass_t, time_min, avg_distance_km, avg_speed_kmh };
  }

  const parsed = {
    id: Number(id),
    name,
    country_code: countryCode,
    country_name: countryName,
    global: buildMode(raw.global),
    euro: buildMode(raw.euro),
    american: buildMode(raw.american),
  };

  // Sanity check: if every numeric field is zero, the layout probably
  // changed underneath us rather than the player genuinely having no data.
  const allZero =
    parsed.global.jobs === 0 &&
    parsed.global.distance_km === 0 &&
    parsed.euro.jobs === 0 &&
    parsed.american.jobs === 0;
  if (allZero) {
    throw new ScrapeError(
      `Parsed all-zero stats for id ${id} - page layout may have changed`,
      'PARSE_SUSPECT'
    );
  }

  return parsed;
}

module.exports = { fetchProfile, ScrapeError };
