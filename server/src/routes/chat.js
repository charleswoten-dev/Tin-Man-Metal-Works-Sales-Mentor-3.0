import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildProfileBlock } from '../lib/systemPrompt.js';

const router = Router();
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const PLACEHOLDER = 'PASTE_YOUR_NEW_ROTATED_KEY_HERE';

router.post('/', async (req, res) => {
  try {
    const { messages, profile, userApiKey } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'A non-empty messages array is required.' });
    }

    // Days 1-90 use Charles's server key; after that, the user's own key (Step 16).
    const apiKey = (userApiKey && userApiKey.trim()) || process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === PLACEHOLDER) {
      return res.status(500).json({ error: 'Server API key is not configured.' });
    }

    const anthropic = new Anthropic({ apiKey });

    // Static prompt as a cached block; per-user profile as a second block.
    const system = [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ];
    const profileBlock = buildProfileBlock(profile);
    if (profileBlock) system.push({ type: 'text', text: profileBlock });

    const cleaned = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
      .map((m) => ({ role: m.role, content: String(m.content) }));

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
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

export default router;
