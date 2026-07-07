import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWalkthroughMarkers, inferCompletedSteps } from './walkthroughMarkers.js';

test('complete message: strips markers, records step + summary', () => {
  const r = extractWalkthroughMarkers(
    'Great work!\n\n[[STEP_DONE:ybr-1]]\n[[STEP_SUMMARY:ybr-1]]\nYour dream buyer: ranchers.\n[[/STEP_SUMMARY]]'
  );
  assert.equal(r.clean, 'Great work!');
  assert.ok(r.stepKeys.includes('ybr-1'));
  assert.equal(r.summaries['ybr-1'], 'Your dream buyer: ranchers.');
  assert.ok(!/\[\[/.test(r.clean));
});

test('BUG 2: a truncated STEP_SUMMARY never leaks into rendered text', () => {
  const r = extractWalkthroughMarkers(
    "Here's your avatar.\n\n[[STEP_SUMMARY:ybr-1]]\nRanchers who value quality and don"
  );
  assert.ok(!/\[\[/.test(r.clean), 'no marker fragment should remain: ' + r.clean);
  assert.equal(r.clean, "Here's your avatar.");
});

test('BUG 2: a bare truncated fragment at the tail is stripped', () => {
  const r = extractWalkthroughMarkers('All set for step 4.\n\n[[STEP');
  assert.ok(!/\[\[/.test(r.clean));
  assert.equal(r.clean, 'All set for step 4.');
});

test('BUG 3: a complete STEP_SUMMARY marks the step done even without STEP_DONE', () => {
  const r = extractWalkthroughMarkers(
    'Nice.\n[[STEP_SUMMARY:ybr-5]]\nThe 7-part offer.\n[[/STEP_SUMMARY]]'
  );
  assert.ok(r.stepKeys.includes('ybr-5'));
});

test('multiple STEP_DONE markers are all recorded', () => {
  const r = extractWalkthroughMarkers('[[STEP_DONE:ybr-1]][[STEP_DONE:ybr-2]]all done');
  assert.ok(r.stepKeys.includes('ybr-1'));
  assert.ok(r.stepKeys.includes('ybr-2'));
});

test('PROJECT_NAME + DREAM_BUYER are parsed and hidden', () => {
  const r = extractWalkthroughMarkers(
    'Call it Custom Fire Pits. [[PROJECT_NAME:Custom Fire Pits]]\n' +
      '[[DREAM_BUYER:Backyard Hosts]]\nHosts who love to entertain.\n[[/DREAM_BUYER]]'
  );
  assert.equal(r.projectName, 'Custom Fire Pits');
  assert.deepEqual(r.dreamBuyer, { name: 'Backyard Hosts', content: 'Hosts who love to entertain.' });
  assert.ok(!/\[\[/.test(r.clean));
});

test('safety: ordinary double brackets a user might type are preserved', () => {
  const r = extractWalkthroughMarkers('Put [[your name]] in the greeting.');
  assert.equal(r.clean, 'Put [[your name]] in the greeting.');
  assert.equal(r.stepKeys.length, 0);
});

// ---- Fallback: infer completion when the mentor drops the hidden markers ----

test('fallback: advancing to Step 7 marks steps 1-6 done (no markers)', () => {
  const r = extractWalkthroughMarkers(
    "Boom — your guarantee is locked in.\n\nReady to move into Step 7 — Write Your Dream Buyer Avatar? This is where we document everything."
  );
  for (let i = 1; i <= 6; i++) assert.ok(r.stepKeys.includes(`ybr-${i}`), `ybr-${i} should be inferred`);
  assert.ok(!r.stepKeys.includes('ybr-7'), 'the step being entered is not yet done');
});

test('fallback: "Step N of 17" header marks all earlier steps', () => {
  assert.deepEqual(
    [...inferCompletedSteps('Step 6 of 17 — Craft Your Power Guarantee. This is where...')].sort(),
    ['ybr-1', 'ybr-2', 'ybr-3', 'ybr-4', 'ybr-5']
  );
});

test('fallback: "finished Step N" marks that exact step', () => {
  const keys = inferCompletedSteps('We just finished Step 2 of 17 — Define Your Emerald City. ✅');
  assert.ok(keys.has('ybr-1'));
  assert.ok(keys.has('ybr-2'));
});

test('fallback: "Step N, locked in" with a YBR title marks step N', () => {
  const keys = inferCompletedSteps("Here's your Step 6, locked in: the Power Guarantee for your shop.");
  assert.ok(keys.has('ybr-6'));
});

test('fallback: a terse "Step N —" header (no "of 17") still marks earlier steps', () => {
  const keys = inferCompletedSteps('Step 9 — Write Your Landing Page. Here is the copy built around Wade. Ready?');
  assert.deepEqual([...keys].sort(), ['ybr-1', 'ybr-2', 'ybr-3', 'ybr-4', 'ybr-5', 'ybr-6', 'ybr-7', 'ybr-8']);
});

test('safety: a gated message that says "step 2 is…" (no header punctuation) marks nothing extra', () => {
  // Gated in by the YBR title, but "step 2 is" is not a header, so no over-mark.
  const keys = inferCompletedSteps('For your landing page, step 2 is to add a testimonial.');
  assert.ok(!keys.has('ybr-1'));
  assert.equal(keys.size, 0);
});

test('fallback: whole-system completion marks all 17', () => {
  const keys = inferCompletedSteps("You finished the full selling system! All 17 steps done.");
  assert.equal(keys.size, 17);
});

test('safety: the kickoff ("all 17 steps, one at a time") marks nothing', () => {
  const keys = inferCompletedSteps(
    "We're going to build your complete sales system together — all 17 steps — one at a time. Before we dive into Step 1, what should we call this project?"
  );
  assert.equal(keys.size, 0);
});

test('safety: ordinary coaching chat that says "step 2" marks nothing', () => {
  const keys = inferCompletedSteps('For pricing, step 2 is to add your ~30% labor burden before you quote.');
  assert.equal(keys.size, 0);
});
