/**
 * Web Push (VAPID) configuration — the three env vars are all-or-nothing.
 * Absent vars disable the feature cleanly: routes answer enabled:false / 503,
 * the sender no-ops, nothing ever crashes. Generate a pair once with
 * `npm run vapid-keys` (see docs/push-notifications.md).
 */

export interface PushVapidConfig {
  publicKey: string;
  privateKey: string;
  /** mailto: contact — required by Apple's push service, ignored by others. */
  subject: string;
}

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const SUBJECT = process.env.VAPID_SUBJECT || '';

export const pushEnabled = PUBLIC_KEY !== '' && PRIVATE_KEY !== '' && SUBJECT !== '';

// Partial configuration is a setup mistake worth flagging at boot.
if (!pushEnabled && (PUBLIC_KEY || PRIVATE_KEY || SUBJECT)) {
  console.warn(
    '[push] VAPID partiellement configuré — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY et VAPID_SUBJECT (mailto:) sont requis ensemble ; push désactivé',
  );
}

export function pushVapidConfig(): PushVapidConfig | null {
  if (!pushEnabled) return null;
  return { publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY, subject: SUBJECT };
}
