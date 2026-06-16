// Loaded as the VERY FIRST import in index.js. ES modules evaluate imported
// modules (depth-first, in source order) before the importing module's body
// runs, so configuring dotenv here — and importing this before anything that
// reads process.env at module top-level (e.g. supabaseAdmin.js) — guarantees
// .env is populated in time. override:true lets .env win over any stale shell
// vars (e.g. a shadowing PORT).
import dotenv from 'dotenv';

dotenv.config({ override: true });
