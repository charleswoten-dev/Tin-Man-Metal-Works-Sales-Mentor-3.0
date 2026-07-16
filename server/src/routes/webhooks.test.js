// Signature verification and payload parsing are what stand between the
// licensing tables and anyone who knows the webhook URL, so they're tested
// directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// webhooks.js reads CLICKFUNNELS_WEBHOOK_SECRET once at module load, and static
// `import`s are hoisted above any code here — so the secret must be set first
// and the module pulled in dynamically, or it would load with no secret.
const SECRET = 'test-secret-for-unit-tests';
process.env.CLICKFUNNELS_WEBHOOK_SECRET = SECRET;
const { verifySignature, extractFields } = await import('./webhooks.js');
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
const nowTs = () => Math.floor(Date.now() / 1000).toString();

// ---- verifySignature ----

test('accepts a ClickFunnels timestamp-prefixed signature', () => {
  const body = Buffer.from(JSON.stringify({ email: 'a@b.com' }));
  const ts = nowTs();
  const sig = sign(Buffer.concat([Buffer.from(`${ts}.`), body]));
  assert.equal(verifySignature(body, sig, ts), true);
});

test('accepts a sha256= prefixed signature', () => {
  const body = Buffer.from('{}');
  const ts = nowTs();
  const sig = sign(Buffer.concat([Buffer.from(`${ts}.`), body]));
  assert.equal(verifySignature(body, `sha256=${sig}`, ts), true);
});

test('accepts a raw-body signature (relay/proxy fallback)', () => {
  const body = Buffer.from(JSON.stringify({ email: 'a@b.com' }));
  assert.equal(verifySignature(body, sign(body), null), true);
});

test('rejects a missing signature', () => {
  assert.equal(verifySignature(Buffer.from('{}'), undefined, nowTs()), false);
  assert.equal(verifySignature(Buffer.from('{}'), '', nowTs()), false);
});

test('rejects a signature made with the wrong secret', () => {
  const body = Buffer.from('{}');
  const ts = nowTs();
  const bad = crypto
    .createHmac('sha256', 'not-the-secret')
    .update(Buffer.concat([Buffer.from(`${ts}.`), body]))
    .digest('hex');
  assert.equal(verifySignature(body, bad, ts), false);
});

test('rejects a tampered body', () => {
  const ts = nowTs();
  const signed = Buffer.from(JSON.stringify({ email: 'real@buyer.com' }));
  const sig = sign(Buffer.concat([Buffer.from(`${ts}.`), signed]));
  const tampered = Buffer.from(JSON.stringify({ email: 'attacker@evil.com' }));
  assert.equal(verifySignature(tampered, sig, ts), false);
});

// Replay protection: an old-but-validly-signed request must not be accepted.
// The timestamp is part of the signed payload, so an attacker can't refresh it.
test('rejects a stale timestamp (replay)', () => {
  const body = Buffer.from('{}');
  const staleTs = (Math.floor(Date.now() / 1000) - 3600).toString();
  const sig = sign(Buffer.concat([Buffer.from(`${staleTs}.`), body]));
  assert.equal(verifySignature(body, sig, staleTs), false);
});

// ---- extractFields ----

test('extracts a ClickFunnels 2.0 payload (contact nested under data)', () => {
  const f = extractFields({
    data: { id: 'ord_99', contact: { email: 'Buyer@Example.COM', first_name: 'Charles' } },
  });
  assert.equal(f.email, 'buyer@example.com'); // normalized for keying
  assert.equal(f.orderId, 'ord_99');
  assert.equal(f.firstName, 'Charles');
});

test('extracts a flat top-level payload', () => {
  const f = extractFields({ email: 'a@b.com', order_id: '123', first_name: 'Sam' });
  assert.equal(f.email, 'a@b.com');
  assert.equal(f.orderId, '123');
});

test('falls back to the first word of a full name', () => {
  assert.equal(extractFields({ email: 'a@b.com', name: 'Charles Woten' }).firstName, 'Charles');
});

test('returns null email when the payload has none (route rejects on this)', () => {
  assert.equal(extractFields({ data: {} }).email, null);
  assert.equal(extractFields({}).email, null);
  assert.equal(extractFields(null).email, null);
});
