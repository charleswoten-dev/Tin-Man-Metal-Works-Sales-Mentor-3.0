import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWalkthroughMarkers, inferCompletedSteps, stepKeyFromMessage } from './walkthroughMarkers.js';

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

test('fallback: "Step N of 17" header marks all earlier steps', () => {
  assert.deepEqual(
    [...inferCompletedSteps('Step 6 of 17 — Craft Your Power Guarantee. This is where...')].sort(),
    ['ybr-1', 'ybr-2', 'ybr-3', 'ybr-4', 'ybr-5']
  );
});

test('fallback: "Step N of 17" marks 1..N-1 (the current step is not yet done)', () => {
  const keys = inferCompletedSteps('Step 2 of 17 — Define Your Emerald City. Let me ask you this…');
  assert.ok(keys.has('ybr-1'));
  assert.ok(!keys.has('ybr-2'), 'the step being introduced is not marked done yet');
});

test('fallback: a real "Step N — <YBR title>" header (no "of 17") marks earlier steps', () => {
  const keys = inferCompletedSteps("Step 4 — Identify Their Wicked Witch. Now let's dig into Pete's fears.");
  assert.deepEqual([...keys].sort(), ['ybr-1', 'ybr-2', 'ybr-3']);
});

// BUG A regression: the mentor writes numbered lists like "Step 1… Step 5" INSIDE
// a deliverable (the buyer's journey in Step 3). Those must NEVER be read as
// walkthrough steps — that used to mark steps done before the user reached them.
test('content-immune: numbered "Step N —/:" mentions inside a deliverable mark nothing', () => {
  const journey =
    "Here's his Yellow Brick Road:\n\nStep 1 — He sees it while scrolling.\n" +
    "Step 2 — He clicks and reads reviews.\nStep 3: The doubt creeps in.\n" +
    "Step 4 — He hesitates on price.\nStep 5 — The Pull: he buys.";
  assert.equal(inferCompletedSteps(journey).size, 0);
  assert.equal(stepKeyFromMessage(journey), null);
});

test('safety: a message that says "step 2 is…" marks nothing', () => {
  const keys = inferCompletedSteps('For your landing page, step 2 is to add a testimonial.');
  assert.equal(keys.size, 0);
});

test('stepKeyFromMessage: "Step N of 17" header wins, even when a next step is mentioned', () => {
  assert.equal(
    stepKeyFromMessage('Step 6 of 17 — Craft Your Power Guarantee. Here it is. Ready to move into Step 7?'),
    'ybr-6'
  );
});

test('stepKeyFromMessage: a real "Step N — <YBR title>" header is detected', () => {
  assert.equal(stepKeyFromMessage('Step 12 — Write Your Ad Copy. Here are two ads for you.'), 'ybr-12');
});

test('stepKeyFromMessage: returns null without a real step header', () => {
  assert.equal(stepKeyFromMessage('Here is a great Facebook ad for your shop.'), null);
  // A numbered process line inside a deliverable is NOT a step header.
  assert.equal(stepKeyFromMessage('Step 4 — he hesitates on the price for a minute.'), null);
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
