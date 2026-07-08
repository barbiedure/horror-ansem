import { Chart } from './Chart.js';
import { makeMazeBackgroundDataURL } from '../game/textures.js';
import { MenuBackground } from './MenuBackground.js';
import { CHAPTERS, getPlayerId, getLocalMaxChapter } from '../game/progress.js';
import { DEV_SHOW_ALL_LEVELS } from '../config.js';
import { badgeChips, leaderboardRow } from './EndScreen.js';
import { icon } from './icons.js';

// Menu : le PREMIER écran doit faire comprendre le principe tout de suite —
// titre + une phrase + charte de santé mentale (live) + leaderboard + PLAY, et le rang du
// joueur en haut. En scrollant : les explications détaillées, puis les fenêtres de lore/niveaux.
const POLL_MS = 5000;

export class Landing {
  constructor(container, { onPlay, volume = 0.8, onVolume }) {
    this.onPlay = onPlay;
    this.onVolume = onVolume;
    this.playerId = getPlayerId();

    this.root = document.createElement('div');
    this.root.className = 'landing';
    this.root.innerHTML = `
      <div class="landing-fx"></div>
      <header class="landing-nav">
        <span class="landing-logo">${icon('skull', { size: 20, cls: 'logo-ic' })}&nbsp;ESCAPE&nbsp;<span class="bonk">ANSEM</span></span>
        <div class="landing-nav-right">
          <div class="rank-chip" data-rank>
            <span class="rank-chip-label">YOUR RANK</span>
            <span class="rank-chip-val" data-rank-val>—</span>
          </div>
          <label class="landing-vol" title="Volume">${icon('volume', { size: 18 })}<input type="range" min="0" max="100" step="1" data-volume /></label>
          <button class="btn-ghost" data-howto>How it works</button>
        </div>
      </header>

      <section class="landing-hero" data-top>
        <h1 class="landing-title">ESCAPE&nbsp;<span class="bonk">ANSEM</span></h1>
        <p class="landing-pitch">
          Your <span class="bonk">sanity</span> <em>is</em> the shared $BONK market cap — pump it and everyone
          heals, let it bleed and everyone rots. Get out before the market breaks you.
        </p>

        <div class="hero-widgets">
          <section class="win win-monitor">
            <div class="win-head">
              <span class="win-title">Mental Health · Live</span>
              <span class="win-tag" data-sanity-val>—</span>
            </div>
            <div class="win-body">
              <canvas class="mh-plot" data-chart></canvas>
            </div>
          </section>

          <section class="win win-board">
            <div class="win-head">
              <span class="win-title">Furthest Survivors</span>
              <span class="win-tag">${icon('trophy', { size: 15 })}</span>
            </div>
            <div class="win-body">
              <ol class="leaderboard lb-progress" data-leaderboard><li class="lb-loading">Loading…</li></ol>
              <p class="board-note">Ranked by how far you get. Die trying and you still count.</p>
            </div>
          </section>
        </div>

        <button class="btn-play landing-play" data-play data-level="0">▶ PLAY</button>
        <div class="landing-scroll-hint">▾ scroll — how it works</div>
      </section>

      <section class="landing-how" data-howto-section>
        <span class="concept-kicker">THE ONE RULE</span>
        <h2 class="concept-title">Your <span class="bonk">mental health</span> IS the market cap.</h2>
        <p class="concept-lead">
          There is a single, shared <strong>MENTAL HEALTH</strong> bar, wired <strong>live to the $BONK
          market cap</strong>. The market <em>is</em> the difficulty — everyone plays at the same sanity, right now.
        </p>

        <div class="concept-flow">
          <div class="cf cf-up">
            <span class="cf-icon">${icon('chart-up', { size: 30 })}</span>
            <b>Market cap UP → sanity rises</b>
            <span>You move faster, you keep your <strong>compass</strong> &amp; <strong>PEPE map</strong>, and Ansem
            loses your trail. Escape becomes possible.</span>
          </div>
          <div class="cf cf-down">
            <span class="cf-icon">${icon('chart-down', { size: 30 })}</span>
            <b>Market cap DOWN → sanity collapses</b>
            <span>Ansem is <strong>always faster</strong> and your aids vanish into the dark.
            Below the threshold, escape is <strong>nearly impossible</strong>.</span>
          </div>
        </div>

        <div class="howto-grid">
          <section class="howto-block">
            <h2>The nightmare</h2>
            <p>You wake in a filthy room — buzzing neons, a broken screen stuck on <em>"Buy the dip."</em>
            Thread the maze while the charts crash, then a door opens and something starts hunting.
            Find the way out before it finds you.</p>
          </section>
          <section class="howto-block">
            <h2>Controls</h2>
            <table class="howto-keys">
              <tr><td>Move</td><td><kbd>Z</kbd>/<kbd>W</kbd> · <kbd>S</kbd> (or ↑ / ↓)</td></tr>
              <tr><td>Turn</td><td><kbd>Q</kbd>·<kbd>A</kbd> / <kbd>D</kbd></td></tr>
              <tr><td>Sprint</td><td><kbd>Shift</kbd></td></tr>
              <tr><td>Jump</td><td><kbd>Space</kbd></td></tr>
              <tr><td>Crouch / crawl</td><td><kbd>Ctrl</kbd> or <kbd>C</kbd></td></tr>
              <tr><td>Flashlight</td><td><kbd>F</kbd></td></tr>
              <tr><td>Pause</td><td><kbd>Esc</kbd></td></tr>
            </table>
          </section>
          <section class="howto-block">
            <h2>Mechanics</h2>
            <ul class="howto-list">
              <li><strong>Sanity</strong> — the lower it is, the faster the monster runs and the further it senses
              you. High sanity even makes <em>you</em> faster.</li>
              <li><strong>Flashlight (F)</strong> — turn it <strong>off</strong>, stand <strong>still</strong> in a
              <strong>corner</strong>, and it may walk right past you.</li>
              <li><strong>Compass &amp; map</strong> — appear automatically while your sanity holds up
              (compass ≥ 20%, map ≥ 30%); they point you toward the way out and whatever you must collect.</li>
              <li><strong>Get caught</strong> and it lunges into a full-screen scream. Then it's over.</li>
            </ul>
          </section>
        </div>
      </section>

      <section class="landing-lore" data-lore></section>

      <section class="landing-grid">
        <div class="panel panel-crypto">
          <h2>$BONK contract</h2>
          <p class="panel-note">Solana · BONK</p>
          <div class="crypto-addr">
            <code data-address>loading…</code>
            <button class="btn-copy" data-copy title="Copy">⧉</button>
          </div>
          <div class="crypto-msg" data-crypto-msg></div>
        </div>
      </section>

      <footer class="landing-foot">A BONK / Solana horror project · built with Three.js</footer>
    `;
    container.appendChild(this.root);

    // Fenêtres de lore (gated) : injectées avant de câbler les boutons [data-play].
    this.root.querySelector('[data-lore]').innerHTML = this.#loreWindowsHtml();

    // Fond : labyrinthe 3D animé + glitches (repli sur une image statique si WebGL échoue).
    const fx = this.root.querySelector('.landing-fx');
    try {
      this.bg = new MenuBackground(fx);
    } catch {
      fx.style.backgroundImage = `url(${makeMazeBackgroundDataURL()})`;
      fx.style.opacity = '0.16';
    }

    for (const b of this.root.querySelectorAll('[data-play]'))
      b.addEventListener('click', () => this.onPlay(Number(b.dataset.level || 0)));
    this.root.querySelector('[data-howto]').addEventListener('click', () =>
      this.root.querySelector('[data-howto-section]').scrollIntoView({ behavior: 'smooth' })
    );
    this.root.querySelector('[data-copy]').addEventListener('click', () => this.#copyAddress());

    const vol = this.root.querySelector('[data-volume]');
    vol.value = String(Math.round((volume ?? 0.8) * 100));
    vol.addEventListener('input', () => this.onVolume?.(Number(vol.value) / 100));

    this.chart = new Chart(this.root.querySelector('[data-chart]'));
    this._onResize = () => this.chart.draw();
    window.addEventListener('resize', this._onResize);

    this.#loadCrypto();
    this.#loadLeaderboard();
    this.#pollSanity();
    this._timer = setInterval(() => this.#pollSanity(), POLL_MS);
  }

  // Fenêtres de lore par chapitre. Gating : au début seule la 1ère (sans dire « niveau 1 ») ;
  // les suivantes apparaissent quand le joueur a atteint ce chapitre. Flag dev = les 3 visibles.
  #loreWindowsHtml() {
    const maxCh = getLocalMaxChapter();
    return CHAPTERS.filter((c) => DEV_SHOW_ALL_LEVELS || c.n <= maxCh)
      .map(
        (c) => `
        <article class="lore-window" style="--accent:${c.badge.color}">
          <div class="lore-window-badge" title="${c.badge.label}">${icon(c.badge.icon, { size: 28 })}</div>
          <h3 class="lore-window-title">${c.title}</h3>
          <p class="lore-window-tag">${c.tagline}</p>
          <p class="lore-window-text">${c.lore}</p>
          <button class="btn-primary" data-play data-level="${c.levelIndex}">Enter</button>
        </article>`
      )
      .join('');
  }

  async #loadCrypto() {
    const codeEl = this.root.querySelector('[data-address]');
    try {
      const res = await fetch('/api/crypto/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      this.address = data.address || 'TBA';
      codeEl.textContent = this.address;
    } catch {
      this.address = null;
      codeEl.textContent = 'unavailable (offline)';
    }
  }

  async #copyAddress() {
    const msg = this.root.querySelector('[data-crypto-msg]');
    if (!this.address || this.address === 'TBA') {
      msg.textContent = 'No address set yet.';
      return;
    }
    try {
      await navigator.clipboard.writeText(this.address);
      msg.textContent = '✅ Copied!';
    } catch {
      msg.textContent = 'Copy failed — select manually.';
    }
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => (msg.textContent = ''), 2000);
  }

  async #pollSanity() {
    if (document.hidden) return; // onglet en arrière-plan → on ne sollicite pas le serveur
    const valEl = this.root.querySelector('[data-sanity-val]');
    try {
      const res = await fetch('/api/global/sanity');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { sanity, history } = await res.json();
      const pct = Math.round(Math.max(0, Math.min(1, sanity)) * 100);
      valEl.textContent = `${pct}%`;
      valEl.style.color = Chart.color(sanity, 1);
      const pts = history && history.length >= 2 ? history : [{ sanity }, { sanity }];
      this.chart.setData(pts);
    } catch {
      valEl.textContent = 'offline';
      valEl.style.color = 'var(--muted)';
    }
  }

  async #loadLeaderboard() {
    const list = this.root.querySelector('[data-leaderboard]');
    try {
      const res = await fetch(`/api/leaderboard?sort=progress&me=${encodeURIComponent(this.playerId)}&limit=10`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const { scores, me } = await res.json();
      this.#renderRank(me);
      if (!scores.length) {
        list.innerHTML = '<li class="lb-empty">No survivors yet. Be the first!</li>';
        return;
      }
      list.innerHTML = scores.map((s, i) => leaderboardRow(s, i, this.playerId)).join('');
    } catch {
      this.#renderRank(null);
      list.innerHTML = '<li class="lb-empty">Leaderboard unavailable (server offline).</li>';
    }
  }

  #renderRank(me) {
    const chip = this.root.querySelector('[data-rank]');
    const val = this.root.querySelector('[data-rank-val]');
    if (!me) {
      chip.classList.remove('ranked');
      val.innerHTML = '<span class="rank-unranked">Play to rank</span>';
      return;
    }
    chip.classList.add('ranked');
    val.innerHTML =
      `<span class="rank-num">#${me.rank}</span>` +
      `<span class="rank-pct">${me.percent}%</span>` +
      `<span class="rank-badges">${badgeChips(me.badges)}</span>`;
  }

  destroy() {
    clearInterval(this._timer);
    clearTimeout(this._msgT);
    window.removeEventListener('resize', this._onResize);
    this.bg?.destroy();
    this.root.remove();
  }
}
