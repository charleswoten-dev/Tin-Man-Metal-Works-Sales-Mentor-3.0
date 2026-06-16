import './loadEnv.js'; // MUST be first — populates process.env before any
// module below reads it at load time (see loadEnv.js).
import express from 'express';
import cors from 'cors';
import healthRouter from './routes/health.js';
import chatRouter from './routes/chat.js';
import webhooksRouter from './routes/webhooks.js';
import registerRouter from './routes/register.js';
import adminRouter from './routes/admin.js';
import { seedDefaultAdmin } from './lib/adminAuth.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust the first proxy hop so express-rate-limit keys off the real client IP
// (X-Forwarded-For) once deployed behind a single reverse proxy / host.
app.set('trust proxy', 1);

// CORS allowlist — only our own app origins may call the API from a browser.
// (Server-to-server callers like the ClickFunnels webhook send no Origin and
// are unaffected.) Requests with no Origin header are allowed too.
const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
  })
);

// Webhooks are mounted BEFORE express.json() because they need the raw request
// body to verify the HMAC signature (the route applies its own raw parser).
app.use('/api/webhooks', webhooksRouter);

app.use(express.json({ limit: '1mb' }));

app.use('/api/health', healthRouter);
app.use('/api/chat', chatRouter);
app.use('/api/register', registerRouter);
app.use('/api/admin', adminRouter);

app.listen(PORT, () => {
  console.log(`🤖 Tin Man server listening on http://localhost:${PORT}`);
  seedDefaultAdmin();
});
