// The 90-day API-key handoff. For the first stretch, everyone runs on Charles's
// shared key; around the 3-month mark each user connects their own so their
// coaching never pauses. The handoff is intentionally GENTLE — two soft
// heads-ups and then a walkthrough. There are deliberately NO countdowns,
// day-counters, or deadlines shown anywhere in the UI.

const DAY = 24 * 60 * 60 * 1000;
const NOTIFY_1 = 80; // first soft heads-up
const NOTIFY_2 = 87; // second soft heads-up
const TUTORIAL = 90; // walkthrough to connect their own key

// How many days since the account was created. Used only for internal gating —
// never surfaced to the user as a number.
function daysSince(createdAt) {
  if (!createdAt) return 0;
  const start = new Date(createdAt).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.floor((Date.now() - start) / DAY);
}

// Returns which (if any) transition prompt is due for this profile:
//   'tutorial' | 'notify87' | 'notify80' | 'none'
// Once the user has connected their own key, nothing more is ever shown.
export function getTransitionState(profile) {
  if (!profile) return 'none';
  if (profile.anthropic_api_key && String(profile.anthropic_api_key).trim()) return 'none';

  const days = daysSince(profile.created_at);

  if (days >= TUTORIAL && !profile.seen_api_transition) return 'tutorial';
  if (days >= NOTIFY_2 && !profile.notified_day_87) return 'notify87';
  if (days >= NOTIFY_1 && !profile.notified_day_80) return 'notify80';
  return 'none';
}

// The profile flag that should be flipped once a given prompt has been shown.
export const FLAG_FOR_STATE = {
  notify80: 'notified_day_80',
  notify87: 'notified_day_87',
  tutorial: 'seen_api_transition',
};
