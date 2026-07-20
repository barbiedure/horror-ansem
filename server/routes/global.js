import { Router } from 'express';
import { getGlobalSanity, setGlobalSanity, sanityHistory } from '../db.js';

// GLOBAL sanity, shared by all players and displayed on the home page.
// Drivable placeholder: the value is stored server-side (one row) with a history
// for the chart. It could later be driven by game results / crypto.

const router = Router();

// Tiny in-memory cache: the value only changes every ~10s (poller tick), so serving
// a 4s-old copy is invisible — and DB load stays O(1) no matter how many visitors
// poll. Keyed by `limit` (landing asks 50, in-game asks 2).
const CACHE_TTL_MS = 4000;
const sanityCache = new Map(); // limit -> { body, at }

// GET /api/global/sanity - current value + history (chart points).
router.get('/global/sanity', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 2), 200);
  const hit = sanityCache.get(limit);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return res.json(hit.body);
  try {
    const state = await getGlobalSanity();
    const history = await sanityHistory(limit);
    const body = { sanity: state.sanity, updated_at: state.updated_at, history };
    sanityCache.set(limit, { body, at: Date.now() });
    res.json(body);
  } catch (err) {
    // Degraded mode: serve the stale cached copy rather than a 500 if the DB hiccups.
    if (hit) return res.json(hit.body);
    console.error('[global] sanity read failed:', err.message);
    res.status(500).json({ error: 'database error' });
  }
});

// POST /api/global/sanity  { sanity: 0..1 } - sets the global value (placeholder driver).
// ADMIN WRITE only: requires the `x-admin-token` header == process.env.ADMIN_TOKEN.
// Without a configured token, the write is refused (prevents public defacement of shared state).
router.post('/global/sanity', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get('x-admin-token') !== token) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { sanity } = req.body ?? {};
  const v = Number(sanity);
  if (!Number.isFinite(v)) return res.status(400).json({ error: 'invalid sanity' });
  try {
    const applied = await setGlobalSanity(v);
    sanityCache.clear();
    res.status(200).json({ sanity: applied });
  } catch (err) {
    console.error('[global] sanity write failed:', err.message);
    res.status(500).json({ error: 'database error' });
  }
});

export default router;
