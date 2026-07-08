// Limiteur de débit en mémoire (fenêtre fixe par IP). Sans dépendance externe.
// NB : mémoire par instance — pour plusieurs instances derrière un load-balancer, il faudrait
// un store partagé (Redis). Suffisant pour brider les floods sur une instance unique.
export function rateLimit({ windowMs = 60_000, max = 40 } = {}) {
  const hits = new Map(); // ip -> { count, reset }

  // Nettoyage périodique des entrées expirées (ne maintient pas le process en vie).
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (now > e.reset) hits.delete(ip);
  }, windowMs);
  timer.unref?.();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let e = hits.get(ip);
    if (!e || now > e.reset) {
      e = { count: 0, reset: now + windowMs };
      hits.set(ip, e);
    }
    e.count++;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: 'trop de requêtes — réessaie dans un instant' });
    }
    next();
  };
}
