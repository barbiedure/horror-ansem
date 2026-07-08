import { Router } from 'express';
import { getGlobalSanity, setGlobalSanity, sanityHistory } from '../db.js';

// Santé mentale GLOBALE, partagée par tous les joueurs et affichée sur la page d'accueil.
// Placeholder pilotable : la valeur est stockée côté serveur (une ligne) avec un historique
// pour la courbe. Elle pourra plus tard être pilotée par les résultats de jeu / la crypto.

const router = Router();

// GET /api/global/sanity — valeur courante + historique (points de la courbe).
router.get('/global/sanity', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 2), 200);
  try {
    const state = await getGlobalSanity();
    const history = await sanityHistory(limit);
    res.json({ sanity: state.sanity, updated_at: state.updated_at, history });
  } catch (err) {
    console.error('[global] échec lecture sanity :', err.message);
    res.status(500).json({ error: 'erreur base de données' });
  }
});

// POST /api/global/sanity  { sanity: 0..1 } — fixe la valeur globale (driver placeholder).
// ÉCRITURE ADMIN uniquement : exige le header `x-admin-token` == process.env.ADMIN_TOKEN.
// Sans token configuré, l'écriture est refusée (empêche le défaçage public de l'état partagé).
router.post('/global/sanity', async (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get('x-admin-token') !== token) {
    return res.status(403).json({ error: 'interdit' });
  }
  const { sanity } = req.body ?? {};
  const v = Number(sanity);
  if (!Number.isFinite(v)) return res.status(400).json({ error: 'sanity invalide' });
  try {
    const applied = await setGlobalSanity(v);
    res.status(200).json({ sanity: applied });
  } catch (err) {
    console.error('[global] échec écriture sanity :', err.message);
    res.status(500).json({ error: 'erreur base de données' });
  }
});

export default router;
