'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./src/routes');
const { getFlag } = require('./src/flags');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1); // needed so express-rate-limit sees the real client IP behind a reverse proxy

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);

// Small, fixed-shape JSON bodies only ({ id: number }) - no reason to accept more.
app.use(express.json({ limit: '2kb' }));

// General flood protection for the whole API.
const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // 60 req/min/IP is generous for normal browsing of the board
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Tighter limiter specifically for the two mutating, scrape-triggering endpoints.
// This is defense-in-depth on top of the business-rule cooldowns enforced in
// src/routes.js (8h per player / 5min globally for new players) - it exists so
// a single IP can't hammer the endpoint with requests that fail validation
// fast (bad id, already-exists, etc.) and still tie up the server / act as an
// amplifier toward worldoftrucks.com.
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment before trying again.' },
});

app.use('/api/players', mutationLimiter);
app.use('/api', generalApiLimiter, apiRoutes);

// Cached flag images: served from data/flags/ on disk, fetched from
// World of Trucks and cached on first request for a given country code.
app.get('/flags/:file', async (req, res) => {
  const m = /^([a-zA-Z0-9_-]{1,10})\.png$/.exec(req.params.file);
  if (!m) return res.status(404).end();
  try {
    const buf = await getFlag(m[1]);
    if (!buf) return res.status(404).end();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=604800, immutable'); // 1 week, browser-side
    res.send(buf);
  } catch (err) {
    res.status(404).end();
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all error handler: never leak stack traces / internals to the
// client, regardless of NODE_ENV (this also cleanly handles malformed
// JSON bodies thrown by express.json()).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status && err.status < 500 ? err.status : 400).json({
    error: 'Invalid request.',
  });
});

app.listen(PORT, () => {
  console.log(`World of Trucks Leaderboard running at http://localhost:${PORT}`);
});
