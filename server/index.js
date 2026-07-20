import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import scoresRouter from './routes/scores.js';
import cryptoRouter from './routes/crypto.js';
import globalRouter from './routes/global.js';
import runRouter from './routes/run.js';
import authRouter from './routes/auth.js';
import { backend, initDb } from './db.js';
import { rateLimit } from './rateLimit.js';
import { startMarketCapPoller } from './marketcap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

const app = express();
// Behind the hosting proxy (Railway, etc.): req.ip = real client IP (X-Forwarded-For),
// otherwise the per-IP rate limiter would see everyone as a single IP (the proxy's).
app.set('trust proxy', 1);
app.use(express.json());

// Permissive CORS in dev (the Vite client runs on :5173).
if (isDev) {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: backend, uptime: process.uptime() });
});

// Rate limit on WRITES (POST): throttles floods that would pollute the leaderboard /
// global sanity and saturate the PG pool. GETs (reads) are not throttled here.
// 150/min: several players often share one IP (same WiFi, mobile CGNAT) and a ranked
// run costs ~4 POSTs (nonce, verify, run/start, scores) — 40 starved whole groups.
const writeLimiter = rateLimit({ windowMs: 60_000, max: 150 });
app.use('/api', (req, res, next) => (req.method === 'POST' ? writeLimiter(req, res, next) : next()));

app.use('/api', authRouter);
app.use('/api', runRouter);
app.use('/api', scoresRouter);
app.use('/api', cryptoRouter);
app.use('/api', globalRouter);

// In production, serves the client's static build.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  // dist/assets/* is content-hashed by Vite → cache forever. Files copied from
  // public/ (audio, textures — ~22 MB) keep their original names → cache 1 day with
  // ETag revalidation (a reload costs a 304, not a re-download). index.html stays
  // no-cache so a new deploy is picked up immediately.
  const assetsDir = path.join(clientDist, 'assets') + path.sep;
  app.use(
    express.static(clientDist, {
      maxAge: '1d',
      setHeaders: (res, filePath) => {
        if (filePath.startsWith(assetsDir)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Creates the schema BEFORE listening (so the schema exists before the 1st request). Best-effort:
// if the database is unreachable, we log and serve anyway (degraded mode → 500 on DB routes).
await initDb()
  .then(() => console.log('[db] schema ready'))
  .catch((err) => console.error('[db] init deferred, database unreachable:', err.message));

// Drives the global sanity from the token's on-chain market cap (every ~10s).
// Best-effort: if RPC/mint are missing or unreachable, the server still runs (see marketcap.js).
startMarketCapPoller();

const server = app.listen(PORT, () => {
  console.log(`🐕  Escape ANSEM - server on http://localhost:${PORT}`);
  if (isDev && !fs.existsSync(clientDist)) {
    console.log('    (dev) start the client with: npm run dev:client  → http://localhost:5173');
  }
});

// Graceful shutdown: on redeploy/restart Railway sends SIGTERM. Finish in-flight
// requests instead of dropping them, then exit; hard-exit after 10s regardless.
function shutdown(signal) {
  console.log(`[server] ${signal} received, draining connections…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
