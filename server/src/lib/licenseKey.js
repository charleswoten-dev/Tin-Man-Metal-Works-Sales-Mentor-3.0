import crypto from 'node:crypto';
import { supabaseAdmin } from './supabaseAdmin.js';

// Unambiguous charset (no 0/O, 1/I) so keys are easy to read and type.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUPS = 3;
const GROUP_LEN = 4;

function randomGroup() {
  let out = '';
  for (let i = 0; i < GROUP_LEN; i++) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return out;
}

// Format: TM3-XXXX-XXXX-XXXX
export function generateLicenseKey() {
  const groups = [];
  for (let i = 0; i < GROUPS; i++) groups.push(randomGroup());
  return `TM3-${groups.join('-')}`;
}

// Generate a key guaranteed not to collide with an existing one.
export async function generateUniqueLicenseKey(maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = generateLicenseKey();
    const { data, error } = await supabaseAdmin
      .from('licenses')
      .select('id')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(`License uniqueness check failed: ${error.message}`);
    if (!data) return key;
  }
  throw new Error('Could not generate a unique license key after multiple attempts.');
}

// Loose validation of the visible format (real validation is a DB lookup).
export function looksLikeLicenseKey(value) {
  return /^TM3-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(String(value || '').trim());
}
