'use strict';

const axios = require('axios');
const { pool } = require('./db');

// World of Trucks が使用する国コードのみを許可
const CODE_RE = /^[a-z0-9_-]{1,10}$/i;
const SOURCE_URL = (code) => `https://www.worldoftrucks.com/img/flags/${code.toLowerCase()}.png`;

// 重複ダウンロード防止用のインフライトロック
const inFlight = new Map();

/**
 * Supabase (PostgreSQL) から国旗 PNG の Buffer を取得、
 * 無ければ World of Trucks から取得して DB に保存する。
 */
async function getFlag(code) {
  if (!code || !CODE_RE.test(code)) return null;
  const key = code.toLowerCase();

  try {
    // 1. Supabase の DB からキャッシュを取得
    const res = await pool.query('SELECT image_data FROM flags WHERE code = $1', [key]);
    if (res.rows.length > 0) {
      return res.rows[0].image_data; // BYTEA は Node.js の Buffer として取得されます
    }
  } catch (err) {
    console.error('Error reading flag from DB:', err.message);
  }

  // 2. 重複フェッチ防止
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    try {
      // 3. World of Trucks から画像をダウンロード
      const res = await axios.get(SOURCE_URL(key), {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WoT-LeaderboardBot/1.0; +https://github.com/)',
        },
        validateStatus: (s) => s === 200,
      });

      const buf = Buffer.from(res.data);

      // 4. Supabase の DB に保存
      await pool.query(
        `INSERT INTO flags (code, image_data)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET image_data = EXCLUDED.image_data`,
        [key, buf]
      );

      return buf;
    } catch (err) {
      return null; // 存在しない国コードなどの場合は 404
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** プレイヤー取得直後のウォームアップ用 */
function warmFlag(code) {
  if (!code) return;
  getFlag(code).catch(() => {});
}

module.exports = { getFlag, warmFlag };