import { Router } from 'express';
import { addScore, topScores, progressBoard, playerRank } from '../db.js';
import { enrich, percentOf, badgesOf } from '../progress.js';

const router = Router();

const DIFFICULTIES = new Set(['facile', 'normal', 'cauchemar', 'custom']);

// POST /api/scores  — soumettre un run (victoire OU mort : on enregistre l'avancement).
router.post('/scores', async (req, res) => {
  const { name, time_ms, maze_size, difficulty, level_reached, player_id, won } = req.body ?? {};

  const cleanName = String(name ?? 'Anonyme').trim().slice(0, 24) || 'Anonyme';
  const ms = Number(time_ms);
  const size = Number(maze_size);
  const diff = DIFFICULTIES.has(difficulty) ? difficulty : 'normal';
  const levelNum = Number(level_reached);
  const level = Number.isFinite(levelNum) ? Math.min(Math.max(Math.round(levelNum), 1), 99) : 1;
  const pid = player_id != null ? String(player_id).trim().slice(0, 64) || null : null;
  // Plausibilité (garde-fou anti-triche léger — PAS une validation autoritative côté serveur) :
  //  - aucun run réel ne dure moins de ~1,5 s (animations de réveil + déplacement) → rejet ;
  //  - « won » n'est cohérent qu'en ayant atteint le dernier chapitre (level_reached ≥ 5).
  const didWin = (won === undefined ? true : Boolean(won)) && level >= 5;

  if (!Number.isFinite(ms) || ms < 1500 || ms > 1000 * 60 * 60) {
    return res.status(400).json({ error: 'time_ms invalide' });
  }
  if (!Number.isFinite(size) || size < 5 || size > 101) {
    return res.status(400).json({ error: 'maze_size invalide' });
  }

  try {
    const id = await addScore({
      name: cleanName,
      time_ms: Math.round(ms),
      maze_size: Math.round(size),
      difficulty: diff,
      level_reached: level,
      player_id: pid,
      won: didWin,
    });
    // Rang à jour du joueur (après insertion) si on a une identité stable.
    const me = pid ? await playerRank(pid) : null;
    res.status(201).json({
      id,
      name: cleanName,
      time_ms: Math.round(ms),
      difficulty: diff,
      level_reached: level,
      won: didWin,
      percent: percentOf(level),
      badges: badgesOf(level, didWin),
      rank: me ? me.rank : null,
      total: me ? me.total : null,
    });
  } catch (err) {
    console.error('[scores] échec addScore :', err.message);
    res.status(500).json({ error: 'erreur base de données' });
  }
});

// GET /api/leaderboard?sort=progress&limit=10&me=<playerId>
//   sort=progress -> classement par avancement (1 ligne/joueur, %, badges)
//   sort=furthest|time&difficulty= -> ancien comportement (compat EndScreen)
router.get('/leaderboard', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const sort = req.query.sort;

  try {
    if (sort === 'progress') {
      const rows = await progressBoard(limit);
      const scores = rows.map(enrich);
      const meId = req.query.me ? String(req.query.me).slice(0, 64) : null;
      const meRow = meId ? await playerRank(meId) : null;
      const me = meRow
        ? {
            rank: meRow.rank,
            total: meRow.total,
            level_reached: meRow.level_reached,
            won: meRow.won,
            percent: percentOf(meRow.level_reached),
            badges: badgesOf(meRow.level_reached, meRow.won),
          }
        : null;
      return res.json({ sort: 'progress', scores, me });
    }

    const { difficulty } = req.query;
    const diff = DIFFICULTIES.has(difficulty) ? difficulty : null;
    const legacySort = sort === 'furthest' ? 'furthest' : 'time';
    const scores = (await topScores(diff, limit, legacySort)).map(enrich);
    res.json({ difficulty: diff, sort: legacySort, scores });
  } catch (err) {
    console.error('[scores] échec leaderboard :', err.message);
    res.status(500).json({ error: 'erreur base de données' });
  }
});

export default router;
