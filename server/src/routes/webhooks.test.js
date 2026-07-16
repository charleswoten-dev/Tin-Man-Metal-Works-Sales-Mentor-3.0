// Signature verification and payload parsing are what stand between the
// licensing tables and anyone who knows the webhook URL, so they're tested
// directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// ClickFunnels signs each endpoint with its own secret, so the env var holds a
// comma-separated list. It's seeded here with sloppy spacing, empty entries and
// the placeholder to prove those are ignored rather than trusted as secrets.
const PROVISION = 'secret-for-provision';
const CANCEL = 'secret-for-cancel';
const REACTIVATE = 'secret-for-reactivate';
const ENDPOINT_SECRETS = [PROVISION, CANCEL, REACTIVATE];
const PLACEHOLDER = 'PASTE_A_STRONG_RANDOM_WEBHOOK_SECRET_HERE';

// webhooks.js reads CLICKFUNNELS_WEBHOOK_SECRET once at module load, and static
// `import`s are hoisted above any code here — so the secret must be set first
// and the module pulled in dynamically, or it would load with no secret.
process.env.CLICKFUNNELS_WEBHOOK_SECRET = ` ${PROVISION} ,${CANCEL},, ${REACTIVATE} , ,${PLACEHOLDER}`;
const { verifySignature, extractFields } = await import('./webhooks.js');

// The single-secret tests below sign with one of the list's secrets — a list of
// one is the old behavior, so they also guard against a regression there.
const SECRET = PROVISION;
const sign = (payload, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');
const nowTs = () => Math.floor(Date.now() / 1000).toString();
const stamped = (body, ts) => Buffer.concat([Buffer.from(`${ts}.`), body]);

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

// ---- multiple endpoint secrets ----

// The whole point of the list: provision, cancel and reactivate each have their
// own ClickFunnels secret, and a request never says which one signed it.
test('accepts a signature from ANY of the endpoint secrets (both schemes)', () => {
  const body = Buffer.from(JSON.stringify({ email: 'a@b.com' }));
  const ts = nowTs();
  for (const secret of ENDPOINT_SECRETS) {
    assert.equal(
      verifySignature(body, sign(stamped(body, ts), secret), ts),
      true,
      `timestamped scheme should validate under ${secret}`
    );
    assert.equal(
      verifySignature(body, sign(body, secret), null),
      true,
      `raw-body fallback should validate under ${secret}`
    );
  }
});

test('rejects a secret that is not in the list', () => {
  const body = Buffer.from('{}');
  const ts = nowTs();
  assert.equal(verifySignature(body, sign(stamped(body, ts), 'secret-for-some-other-app'), ts), false);
});

test('blank/whitespace-only entries in the list are ignored, not trusted', () => {
  const body = Buffer.from('{}');
  const ts = nowTs();
  // An empty entry would mean HMAC with a '' key — must never validate.
  assert.equal(verifySignature(body, sign(stamped(body, ts), ''), ts), false);
  assert.equal(verifySignature(body, sign(stamped(body, ts), ' '), ts), false);
});

test('the placeholder is ignored even when present in the list', () => {
  const body = Buffer.from('{}');
  const ts = nowTs();
  assert.equal(verifySignature(body, sign(stamped(body, ts), PLACEHOLDER), ts), false);
});

// Replay protection must hold for every secret, not just the first.
test('rejects a stale timestamp under any endpoint secret', () => {
  const body = Buffer.from('{}');
  const staleTs = (Math.floor(Date.now() / 1000) - 3600).toString();
  for (const secret of ENDPOINT_SECRETS) {
    assert.equal(verifySignature(body, sign(stamped(body, staleTs), secret), staleTs), false);
  }
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
