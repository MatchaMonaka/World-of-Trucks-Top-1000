'use strict';

const KM_PER_MILE = 1.609344;

/**
 * "1,234" / "-" -> integer
 */
function parseIntSafe(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (s === '-' || s === '') return 0;
  const cleaned = s.replace(/[^\d.-]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * "1,645,196 km" / "49,039 mi" / "-" -> distance in km (canonical storage unit)
 */
function parseDistanceToKm(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (s === '-' || s === '') return 0;
  const m = s.match(/([\d.,]+)\s*(km|mi)/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(num)) return 0;
  const unit = m[2].toLowerCase();
  return unit === 'mi' ? num * KM_PER_MILE : num;
}

/**
 * "36,175 t" / "-" -> tonnes
 */
function parseMassToTonnes(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (s === '-' || s === '') return 0;
  const m = s.match(/([\d.,]+)\s*t/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/,/g, ''));
  return Number.isFinite(num) ? num : 0;
}

/**
 * "1,099 h 39 min" / "-" -> total minutes (integer)
 */
function parseTimeToMinutes(str) {
  if (!str) return 0;
  const s = String(str).trim();
  if (s === '-' || s === '') return 0;
  const hMatch = s.match(/([\d.,]+)\s*h/i);
  const mMatch = s.match(/(\d+)\s*min/i);
  const hours = hMatch ? parseFloat(hMatch[1].replace(/,/g, '')) : 0;
  const minutes = mMatch ? parseInt(mMatch[1], 10) : 0;
  return Math.round(hours * 60 + minutes);
}

/**
 * Extract country code from a flag image src, e.g. "/img/flags/jpn.png" -> "jpn"
 */
function parseCountryCode(src) {
  if (!src) return null;
  const m = String(src).match(/\/flags\/([a-zA-Z0-9_-]+)\.png/i);
  return m ? m[1].toLowerCase() : null;
}

function kmToMi(km) {
  return km / KM_PER_MILE;
}

function minutesToHm(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return { h, m };
}

module.exports = {
  KM_PER_MILE,
  parseIntSafe,
  parseDistanceToKm,
  parseMassToTonnes,
  parseTimeToMinutes,
  parseCountryCode,
  kmToMi,
  minutesToHm,
};
