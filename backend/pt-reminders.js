// Knee PT push sender. Run by `pt remind` as a scheduler command job every
// tick (15 min): works out which reminders came due since the last run, using
// the same schedule logic as the PWA, and sends them as Web Push to every
// subscribed device. Design: docs/pt-app.md.

const {
  ptNormalizeSettings,
  ptRemindersDue,
} = require('../frontend/pt/pt-core.js');

const TICK_MS = 15 * 60 * 1000;
// After downtime, don't fire a pile of stale nudges: look back at most this far.
const DEFAULT_MAX_WINDOW_MS = 30 * 60 * 1000;

// Declarative Web Push (iOS 18.4+ displays it without the service worker);
// sw-v2.js shows the same fields on every other browser.
function buildPayload(reminder, appUrl) {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: 'Knee PT',
      body: reminder.label,
      navigate: appUrl,
      tag: 'pt-' + reminder.kind,
    },
  });
}

// One notification per reminder kind per run: if several sitting breaks are
// due at once, only the latest one matters.
function latestPerKind(due) {
  const byKind = {};
  for (const r of due) {
    if (!byKind[r.kind] || r.at > byKind[r.kind].at) byKind[r.kind] = r;
  }
  return due.filter((r) => byKind[r.kind] === r);
}

async function sendDueReminders({ storage, sendPush, appUrl, now = Date.now(), maxWindowMs = DEFAULT_MAX_WINDOW_MS }) {
  const row = await storage.getPtSettings();
  if (!row || !row.settings) return { skipped: 'no PT settings saved yet (open the app once)' };

  const settings = ptNormalizeSettings(row.settings);
  const last = row.push_checked_at ? new Date(row.push_checked_at).getTime() : now - TICK_MS;
  const from = Math.max(last, now - maxWindowMs);
  const due = latestPerKind(ptRemindersDue(settings, from, now));

  const result = { from, to: now, due, sent: 0, failed: 0, removed: 0 };
  if (due.length) {
    const subs = await storage.listPtPushSubscriptions();
    for (const sub of subs) {
      const target = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      let gone = false;
      for (const reminder of due) {
        if (gone) break;
        try {
          await sendPush(target, buildPayload(reminder, appUrl));
          await storage.updatePtPushSubscription(sub.id, { last_sent_at: new Date(now).toISOString(), last_error: null });
          result.sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // The device unsubscribed or the app was removed from the Home Screen.
            await storage.deletePtPushSubscription(sub.id);
            result.removed++;
            gone = true;
          } else {
            await storage.updatePtPushSubscription(sub.id, { last_error: String(err.message || err).slice(0, 500) });
            result.failed++;
          }
        }
      }
    }
  }

  await storage.setPtPushCheckedAt(new Date(now).toISOString());
  return result;
}

// The real sender, from the `web-push` package and VAPID keys in the
// environment (.env on the scheduler host). Throws a setup hint when missing.
function webPushSender(env = process.env) {
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
    if (!env[key]) throw new Error(`${key} is not set. See docs/pt-app.md ("Push setup").`);
  }
  let webpush;
  try {
    webpush = require('web-push');
  } catch (e) {
    throw new Error('The web-push package is not installed. Run `npm install` in the Brainy checkout.');
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  return (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 30 * 60, urgency: 'high' });
}

module.exports = { sendDueReminders, buildPayload, webPushSender };
