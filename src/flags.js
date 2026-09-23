'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const axios = require('axios');

const FLAG_DIR = process.env.FLAG_DIR || path.join(__dirname, '..', 'data', 'flags');
if (!fs.existsSync(FLAG_DIR)) fs.mkdirSync(FLAG_DIR, { recursive: true });

// Only allow the kind of country codes World of Trucks actually uses
// (e.g. "jpn", "usa", "deu") - guards against path traversal too.
const CODE_RE = /^[a-z0-9_-]{1,10}$/i;

const SOURCE_URL = (code) => `https://www.worldoftrucks.com/img/flags/${code.toLowerCase()}.png`;

function localPath(code) {
  return path.join(FLAG_DIR, `${code.toLowerCase()}.png`);
}

// Prevent duplicate concurrent downloads of the same flag.
const inFlight = new Map();

/**
 * Returns a Buffer of the flag PNG, serving from local cache when present
 * and downloading + caching it from World of Trucks on first request.
 * Returns null if the code is invalid or the source has no such flag.
 */
async function getFlag(code) {
  if (!code || !CODE_RE.test(code)) return null;
  const file = localPath(code);

  try {
    return await fsp.readFile(file);
  } catch (_) {
    // not cached yet - fall through to fetch
  }

  const key = code.toLowerCase();
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    try {
      const res = await axios.get(SOURCE_URL(key), {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WoT-LeaderboardBot/1.0; +https://github.com/)',
        },
        validateStatus: (s) => s === 200,
      });
      const buf = Buffer.from(res.data);
      await fsp.writeFile(file, buf);
      return buf;
    } catch (err) {
      return null; // unknown/broken flag code - caller should 404
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Fire-and-forget warm-up, used right after a player is scraped. */
function warmFlag(code) {
  if (!code) return;
  getFlag(code).catch(() => {});
}

module.exports = { getFlag, warmFlag, localPath, FLAG_DIR };
