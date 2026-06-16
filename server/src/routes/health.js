import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ ok: true, service: 'tin-man-server', version: '3.0.0' });
});

export default router;
