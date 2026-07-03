import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWithContinuation } from './continuation.js';

const say = (text, stop_reason) => ({ content: [{ type: 'text', text }], stop_reason });

// A fake Anthropic client that hands back queued responses in order and counts calls.
function fakeAnthropic(responses) {
  let i = 0;
  const calls = { n: 0 };
  return {
    calls,
    messages: {
      create: async () => {
        calls.n += 1;
        return responses[Math.min(i++, responses.length - 1)];
      },
    },
  };
}

test('a complete reply is returned as-is (no extra calls)', async () => {
  const a = fakeAnthropic([say('Hello there.', 'end_turn')]);
  const out = await generateWithContinuation(a, { messages: [] });
  assert.equal(out, 'Hello there.');
  assert.equal(a.calls.n, 1);
});

test('continues across a max_tokens truncation and stitches the pieces', async () => {
  const a = fakeAnthropic([
    say('Part one ', 'max_tokens'),
    say('and part two. [[STEP_DONE:ybr-1]]', 'end_turn'),
  ]);
  const out = await generateWithContinuation(a, { messages: [] });
  assert.equal(out, 'Part one and part two. [[STEP_DONE:ybr-1]]');
  assert.equal(a.calls.n, 2);
});

test('gives up after MAX_CONTINUATIONS even if still truncating', async () => {
  const a = fakeAnthropic([
    say('a', 'max_tokens'),
    say('b', 'max_tokens'),
    say('c', 'max_tokens'),
    say('d', 'max_tokens'),
    say('e', 'max_tokens'),
  ]);
  await generateWithContinuation(a, { messages: [] });
  assert.equal(a.calls.n, 4); // initial + 3 continuations, then stop
});

test('does not loop forever on an empty truncated part', async () => {
  const a = fakeAnthropic([say('', 'max_tokens')]);
  const out = await generateWithContinuation(a, { messages: [] });
  assert.equal(out, '');
  assert.equal(a.calls.n, 1); // empty part breaks the loop
});
