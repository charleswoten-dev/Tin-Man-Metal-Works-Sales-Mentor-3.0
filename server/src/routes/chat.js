import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildProfileBlock, buildShopRateBlock, buildDreamBuyersBlock } from '../lib/systemPrompt.js';

const router = Router();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const PLACEHOLDER = 'PASTE_YOUR_NEW_ROTATED_KEY_HERE';

// Shared setup for both the buffered (/) and streaming (/stream) endpoints.
// Returns { error, status } on a bad request, or the ready-to-call pieces.
function prepare(body) {
  const { messages, profile, shopRate, userApiKey, maxTokens, dreamBuyers } = body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'A non-empty messages array is required.', status: 400 };
  }

  // Chat replies are short (2048), but the product-asset generators (landing
  // pages, 7-part email sequences) need more room. Allow the caller to request
  // a higher ceiling, clamped so a bad value can't blow up cost/latency.
  const requested = Number.isFinite(maxTokens) ? Math.floor(maxTokens) : 2048;
  const outputTokens = Math.min(Math.max(requested, 256), 8192);

  // Days 1-90 use Charles's server key; after that, the user's own key (Step 16).
  // Always .trim() — a stray space/newline pasted into the env var (or the user's
  // key field) makes the x-api-key header malformed, which manifests as a
  // connection-level "Premature close" rather than a clean 401.
  const apiKey = (userApiKey && userApiKey.trim()) || (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey || apiKey === PLACEHOLDER) {
    return { error: 'Server API key is not configured.', status: 500 };
  }

  const anthropic = new Anthropic({ apiKey });

  // Static prompt as a cached block; per-user profile as a second block.
  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
  ];
  const profileBlock = buildProfileBlock(profile);
  if (profileBlock) system.push({ type: 'text', text: profileBlock });
  const shopRateBlock = buildShopRateBlock(shopRate);
  if (shopRateBlock) system.push({ type: 'text', text: shopRateBlock });
  const dreamBuyersBlock = buildDreamBuyersBlock(dreamBuyers);
  if (dreamBuyersBlock) system.push({ type: 'text', text: dreamBuyersBlock });

  const cleaned = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }));

  return { anthropic, system, cleaned, outputTokens };
}

// Buffered reply (used by the chat view).
router.post('/', async (req, res) => {
  try {
    const prep = prepare(req.body);
    if (prep.error) return res.status(prep.status).json({ error: prep.error });
    const { anthropic, system, cleaned, outputTokens } = prep;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: outputTokens,
      system,
      messages: cleaned,
    });

    const reply = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    res.json({ reply, usage: response.usage });
  } catch (err) {
    console.error('Chat error:', err?.status, err?.message || err);
    const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
    res.status(status).json({ error: err?.message || 'Chat request failed.' });
  }
});

// Streaming reply (used by the product-asset generators so long documents show
// up live instead of after a long blank wait). Server-Sent Events: each event
// is `data: {json}\n\n` with either { text } deltas, a final { done }, or { error }.
router.post('/stream', async (req, res) => {
  const prep = prepare(req.body);
  if (prep.error) return res.status(prep.status).json({ error: prep.error });
  const { anthropic, system, cleaned, outputTokens } = prep;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // don't let proxies buffer the stream
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: outputTokens,
      system,
      messages: cleaned,
    });
    stream.on('text', (delta) => send({ text: delta }));
    await stream.finalMessage();
    send({ done: true });
    res.end();
  } catch (err) {
    console.error('Chat stream error:', err?.status, err?.message || err);
    send({ error: err?.message || 'Chat request failed.' });
    res.end();
  }
});

export default router;
