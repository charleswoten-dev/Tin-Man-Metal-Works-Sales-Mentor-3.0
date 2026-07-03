import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWalkthroughMarkers } from './walkthroughMarkers.js';

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
