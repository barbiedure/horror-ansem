// Écran de fin de partie : victoire (évasion) ou défaite (capturé).
// Dans les DEUX cas on enregistre l'avancement au leaderboard (classement par % de progression).
// Affiche le rang du joueur, son % atteint, ses badges, et le Top 10 par avancement.

import {
  CHAPTERS,
  percentOf,
  badgesOf,
  getPlayerId,
  getPlayerName,
  setPlayerName,
} from '../game/progress.js';
import { icon } from './icons.js';

export class EndScreen {
  constructor(container, { won, timeMs, config, levelReached = 1, onReplay, onMenu }) {
    this.container = container;
    this.config = config;
    this.timeMs = timeMs;
    this.levelReached = levelReached;
    this.won = won;
    this.onReplay = onReplay;
    this.onMenu = onMenu;
    this.playerId = getPlayerId();
    this.percent = percentOf(levelReached);
    this.submitted = false; // garde d'idempotence : un run = UNE seule ligne enregistrée

    this.root = document.createElement('div');
    this.root.className = `endscreen ${won ? 'win' : 'lose'}`;
    this.root.innerHTML = this.#html();
    // Monté sur <body> (pas sur le conteneur du jeu) → position:fixed relative au VRAI viewport,
    // à l'abri de tout ancêtre transformé/filtré : la fenêtre reste centrée, sans scroll.
    document.body.appendChild(this.root);

    // À la sortie de l'écran (rejouer / menu), on enregistre le run une dernière fois si le joueur
    // n'a pas cliqué « Save my name » — ainsi mort ET victoire sont enregistrées, mais UNE seule
    // fois (garde `submitted`), sans doublon ni écrasement du pseudo par l'auto-soumission.
    this.root.querySelector('[data-replay]').addEventListener('click', () => {
      this.#submitScore();
      this.destroy();
      onReplay();
    });
    this.root.querySelector('[data-menu]').addEventListener('click', () => {
      this.#submitScore();
      this.destroy();
      onMenu();
    });

    const form = this.root.querySelector('[data-score-form]');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submitScore();
    });

    this.#loadLeaderboard();
  }

  #html() {
    const title = this.won
      ? `<h1 class="end-title">${icon('exit', { size: 34 })} ESCAPED!</h1>`
      : `<h1 class="end-title dead">${icon('skull', { size: 34 })} CAUGHT</h1>`;
    const verb = this.won ? 'You got away from Ansem in' : 'Ansem got you after';
    const earned = badgesOf(this.levelReached, this.won);
    return `
      <div class="end-panel">
        ${title}
        <p class="end-sub">${verb} <strong>${(this.timeMs / 1000).toFixed(2)}s</strong></p>
        <div class="end-progress">
          <span class="end-pct">${this.percent}%</span>
          <div class="end-badges">${badgeChips(earned)}</div>
        </div>
        <form data-score-form class="score-form">
          <input type="text" name="name" maxlength="24" placeholder="Your name" autocomplete="off"
                 value="${escapeHtml(getPlayerName())}" />
          <button type="submit">Save my name</button>
        </form>
        <div class="submit-msg" data-submit-msg></div>
        <h2 class="lb-title">${icon('trophy', { size: 16 })} Furthest survivors</h2>
        <ol class="leaderboard lb-progress" data-leaderboard><li class="lb-loading">Loading…</li></ol>
        <div class="end-actions">
          <button class="btn-primary" data-replay>${this.won ? 'Play again' : 'Try again'}</button>
          <button class="btn-ghost" data-menu>Menu</button>
        </div>
      </div>`;
  }

  async #submitScore() {
    if (this.submitted) return; // un seul enregistrement par run (pas de doublon)
    this.submitted = true;
    const input = this.root.querySelector('input[name="name"]');
    const msg = this.root.querySelector('[data-submit-msg]');
    const typed = input.value.trim();
    const name = typed || getPlayerName() || 'Anonymous';
    if (typed) setPlayerName(typed);
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          time_ms: Math.round(this.timeMs),
          maze_size: 21, // carte fixe (compat schéma leaderboard)
          difficulty: this.config.difficulty,
          level_reached: this.levelReached,
          player_id: this.playerId,
          won: this.won,
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.rank) {
        msg.textContent = `✅ Saved · you're #${data.rank}${data.total ? ` / ${data.total}` : ''}`;
      } else {
        msg.textContent = '✅ Saved!';
      }
      this.#loadLeaderboard();
    } catch {
      this.submitted = false; // échec réseau → on autorise une nouvelle tentative
      msg.textContent = '⚠️ Could not save (server offline?)';
    }
  }

  async #loadLeaderboard() {
    const list = this.root.querySelector('[data-leaderboard]');
    try {
      const res = await fetch(`/api/leaderboard?sort=progress&me=${encodeURIComponent(this.playerId)}&limit=10`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { scores } = await res.json();
      if (!scores.length) {
        list.innerHTML = '<li class="lb-empty">No runs yet. Be the first!</li>';
        return;
      }
      list.innerHTML = scores.map((s, i) => leaderboardRow(s, i, this.playerId)).join('');
    } catch {
      list.innerHTML = '<li class="lb-empty">Leaderboard unavailable (server offline).</li>';
    }
  }

  destroy() {
    this.root.remove();
  }
}

// Puces de badges (chapitres franchis).
export function badgeChips(badgeNums) {
  if (!badgeNums || !badgeNums.length) return '';
  return badgeNums
    .map((n) => {
      const b = CHAPTERS[n - 1]?.badge;
      if (!b) return '';
      return `<span class="badge-chip" style="--chip:${b.color}" title="${escapeHtml(b.label)}">${icon(b.icon, { size: 13 })}</span>`;
    })
    .join('');
}

// Une ligne de classement par avancement (rang, pseudo, %, badges, temps).
export function leaderboardRow(s, i, meId) {
  const mine = meId && s.player_id === meId ? ' class="lb-me"' : '';
  return (
    `<li${mine}><span class="lb-rank">#${i + 1}</span>` +
    `<span class="lb-name">${escapeHtml(s.name)}</span>` +
    `<span class="lb-badges">${badgeChips(s.badges)}</span>` +
    `<span class="lb-pct">${s.percent ?? 0}%</span>` +
    `<span class="lb-time">${(s.time_ms / 1000).toFixed(2)}s</span></li>`
  );
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
