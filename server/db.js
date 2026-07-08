// Persistance des scores — backend PostgreSQL.
//
// La connexion est configurée via la variable d'environnement DATABASE_URL,
// p. ex. : postgres://user:password@localhost:5432/escape_bonk
// À défaut, on retombe sur une connexion locale par défaut (voir DEFAULT_URL).

import pg from 'pg';

const { Pool } = pg;

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5434/escape_bonk';
const connectionString = process.env.DATABASE_URL || DEFAULT_URL;

// SSL activé si demandé (services managés type Neon/Render/Heroku).
const ssl =
  process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined;

// Pool élargi (défaut pg = 10) pour tenir davantage de requêtes concurrentes ; réglable via env.
const pool = new Pool({ connectionString, ssl, max: Number(process.env.PG_POOL_MAX) || 20 });

pool.on('error', (err) => {
  console.error('[db] erreur inattendue du pool PostgreSQL :', err.message);
});

/** @typedef {{ name:string, time_ms:number, maze_size:number, difficulty:string, level_reached?:number, player_id?:string|null, won?:boolean }} ScoreInput */

export const backend = 'postgres';

// Création du schéma. NE PAS bloquer le démarrage si la base est injoignable : on log un
// avertissement et le serveur reste debout (les routes renverront alors une erreur 500 et
// le client bascule proprement en mode « hors-ligne »). initDb() est ré-appelable.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scores (
      id         SERIAL      PRIMARY KEY,
      name       TEXT        NOT NULL,
      time_ms    INTEGER     NOT NULL,
      maze_size  INTEGER     NOT NULL,
      difficulty TEXT        NOT NULL DEFAULT 'normal',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE scores ADD COLUMN IF NOT EXISTS level_reached INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE scores ADD COLUMN IF NOT EXISTS player_id TEXT;
    ALTER TABLE scores ADD COLUMN IF NOT EXISTS won BOOLEAN NOT NULL DEFAULT true;
    CREATE INDEX IF NOT EXISTS idx_scores_time ON scores(time_ms ASC);
    CREATE INDEX IF NOT EXISTS idx_scores_furthest ON scores(level_reached DESC, time_ms ASC);
    CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_id);
    -- Index fonctionnel pour le classement par avancement (DISTINCT ON sur la clé joueur + tri) :
    -- évite le full-scan/full-sort sur les chemins les plus chauds (progressBoard, playerRank).
    CREATE INDEX IF NOT EXISTS idx_scores_progress
      ON scores ((COALESCE(player_id, 'name:' || name)), level_reached DESC, won DESC, time_ms ASC);
    CREATE TABLE IF NOT EXISTS global_state (
      id         INTEGER     PRIMARY KEY DEFAULT 1,
      sanity     REAL        NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO global_state (id, sanity) VALUES (1, 1)
      ON CONFLICT (id) DO NOTHING;

    -- Historique (points de la courbe affichée sur la page d'accueil).
    CREATE TABLE IF NOT EXISTS sanity_history (
      id     SERIAL      PRIMARY KEY,
      sanity REAL        NOT NULL,
      at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sanity_history_at ON sanity_history(at DESC);
  `);
}
// initDb() est désormais AWAITÉ au démarrage par index.js (avant app.listen) → le schéma existe
// avant de servir la moindre requête. Reste ré-appelable et non bloquant si la base est down.

/** @param {ScoreInput} s */
export async function addScore(s) {
  const { rows } = await pool.query(
    `INSERT INTO scores (name, time_ms, maze_size, difficulty, level_reached, player_id, won)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [s.name, s.time_ms, s.maze_size, s.difficulty, s.level_reached ?? 1, s.player_id ?? null, s.won ?? true]
  );
  return rows[0].id;
}

// sort : 'furthest' (plus loin dans le jeu, puis le plus rapide) sinon 'time' (le plus rapide).
export async function topScores(difficulty, limit = 10, sort = 'time') {
  const order = sort === 'furthest' ? 'level_reached DESC, time_ms ASC' : 'time_ms ASC';
  const cols = 'id, name, time_ms, maze_size, difficulty, level_reached, won, created_at';
  if (difficulty) {
    const { rows } = await pool.query(
      `SELECT ${cols} FROM scores WHERE difficulty = $1 ORDER BY ${order} LIMIT $2`,
      [difficulty, limit]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT ${cols} FROM scores ORDER BY ${order} LIMIT $1`,
    [limit]
  );
  return rows;
}

// Clé de regroupement d'un joueur : son player_id stable, ou à défaut son pseudo.
const PLAYER_KEY = `COALESCE(player_id, 'name:' || name)`;
// Ordre d'avancement : le plus loin, puis vainqueur avant mort, puis le plus rapide.
const PROGRESS_ORDER = 'level_reached DESC, won DESC, time_ms ASC';

// Classement par AVANCEMENT : une seule ligne par joueur (son meilleur run).
export async function progressBoard(limit = 10) {
  const { rows } = await pool.query(
    `WITH best AS (
       SELECT DISTINCT ON (${PLAYER_KEY})
         name, player_id, time_ms, level_reached, won
       FROM scores
       ORDER BY ${PLAYER_KEY}, ${PROGRESS_ORDER}
     )
     SELECT * FROM best ORDER BY ${PROGRESS_ORDER} LIMIT $1`,
    [limit]
  );
  return rows;
}

// Rang d'un joueur donné (par player_id) dans le classement d'avancement.
export async function playerRank(playerId) {
  if (!playerId) return null;
  const { rows } = await pool.query(
    `WITH best AS (
       SELECT DISTINCT ON (${PLAYER_KEY})
         ${PLAYER_KEY} AS pkey, player_id, name, time_ms, level_reached, won
       FROM scores
       ORDER BY ${PLAYER_KEY}, ${PROGRESS_ORDER}
     ),
     ranked AS (
       SELECT player_id, name, time_ms, level_reached, won,
         RANK() OVER (ORDER BY ${PROGRESS_ORDER}) AS rank,
         COUNT(*) OVER () AS total
       FROM best
     )
     SELECT rank, total, level_reached, won, time_ms, name
     FROM ranked WHERE player_id = $1 LIMIT 1`,
    [playerId]
  );
  return rows[0] ?? null;
}

// ---------- Santé mentale globale (placeholder pilotable) ----------

export async function getGlobalSanity() {
  const { rows } = await pool.query('SELECT sanity, updated_at FROM global_state WHERE id = 1');
  return rows[0] ?? { sanity: 1, updated_at: null };
}

// Fixe la valeur globale [0..1] et pousse un point d'historique.
export async function setGlobalSanity(v) {
  const sanity = Math.max(0, Math.min(1, Number(v)));
  await pool.query(
    `UPDATE global_state SET sanity = $1, updated_at = now() WHERE id = 1`,
    [sanity]
  );
  await pool.query('INSERT INTO sanity_history (sanity) VALUES ($1)', [sanity]);
  // Élagage : on ne conserve que les ~500 points les plus récents (croissance bornée).
  await pool.query(
    `DELETE FROM sanity_history
     WHERE id NOT IN (SELECT id FROM sanity_history ORDER BY at DESC LIMIT 500)`
  );
  return sanity;
}

export async function sanityHistory(limit = 50) {
  const { rows } = await pool.query(
    `SELECT sanity, at FROM sanity_history ORDER BY at DESC LIMIT $1`,
    [limit]
  );
  return rows.reverse(); // ordre chronologique croissant pour la courbe
}

console.log(`[db] backend de persistance : ${backend}`);
