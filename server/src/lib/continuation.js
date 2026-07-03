// When a reply hits the max_tokens ceiling it's cut off mid-thought — and the
// walkthrough control tokens that sit at the END of a message are lost, which
// breaks progress tracking and leaks half-emitted tokens. So instead of
// truncating, we continue the generation up to MAX_CONTINUATIONS extra rounds
// and stitch the pieces together.

export const MAX_CONTINUATIONS = 3;
export const CONTINUE_MSG =
  'Continue exactly where you left off. Do not repeat anything you already wrote.';

export const textOf = (msg) =>
  (msg?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

// Buffered completion with auto-continue. `anthropic` only needs a
// `.messages.create(...)` that resolves to a message with `content` + `stop_reason`.
export async function generateWithContinuation(anthropic, { model, max_tokens, system, messages }) {
  let msgs = Array.isArray(messages) ? messages : [];
  let full = '';
  for (let round = 0; ; round++) {
    const response = await anthropic.messages.create({ model, max_tokens, system, messages: msgs });
    const part = textOf(response);
    full += part;
    if (response.stop_reason === 'max_tokens' && part && round < MAX_CONTINUATIONS) {
      msgs = [...msgs, { role: 'assistant', content: part }, { role: 'user', content: CONTINUE_MSG }];
      continue;
    }
    break;
  }
  return full.trim();
}
