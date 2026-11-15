// Tracker push sender. Run by `tracker remind` as a scheduler command job
// every tick (15 min): for each of the user's trackers, works out which
// reminders came due since that tracker's last check, using the same schedule
// logic as the PWA, and sends them as Web Push to every subscribed device.
// Design: docs/tracker-app.md.

const { trkNormalizeSettings, trkRemindersDue } = require('../frontend/tracker/tracker-core.js');

const TICK_MS = 15 * 60 * 1000;
// After downtime, don't fire a pile of stale nudges: look back at most this far.
const DEFAULT_MAX_WINDOW_MS = 30 * 60 * 1000;

// Declarative Web Push (iOS 18.4+ displays it without the service worker);
// sw-v2.js shows the same fields on every other browser. A tap opens that tracker.
function buildPayload(reminder, appUrl) {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: reminder.title,
      body: reminder.label,
      navigate: appUrl + '?t=' + encodeURIComponent(reminder.tracker),
      tag: reminder.tracker + '-' + reminder.kind,
    },
  });
}

// One notification per reminder kind per run: if several breaks are due at
// once, only the latest one matters.
function latestPerKind(due) {
  const byKind = {};
  for (const r of due) {
    if (!byKind[r.kind] || r.at > byKind[r.kind].at) byKind[r.kind] = r;
  }
  return due.filter((r) => byKind[r.kind] === r);
}

async function sendDueReminders({ storage, sendPush, appUrl, now = Date.now(), maxWindowMs = DEFAULT_MAX_WINDOW_MS }) {
  const rows = await storage.listTrackerSettings();
  const result = { trackers: [], due: [], errors: [], sent: 0, failed: 0, removed: 0 };

  for (const row of rows) {
    let settings;
    try {
      settings = trkNormalizeSettings(row.settings);
    } catch (err) {
      // One tracker's bad settings must not stop the others' reminders.
      result.errors.push({ tracker: row.tracker, error: err.message });
      continue;
    }
    const last = row.push_checked_at ? new Date(row.push_checked_at).getTime() : now - TICK_MS;
    const from = Math.max(last, now - maxWindowMs);
    const due = latestPerKind(trkRemindersDue(settings, from, now))
      .map((r) => ({ ...r, tracker: row.tracker, title: settings.title }));
    result.trackers.push({ tracker: row.tracker, from, to: now, due: due.length });
    result.due.push(...due);
  }

  if (result.due.length) {
    const subs = await storage.listTrackerPushSubscriptions();
    for (const sub of subs) {
      const target = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      for (const reminder of result.due) {
        try {
          await sendPush(target, buildPayload(reminder, appUrl));
          await storage.updateTrackerPushSubscription(sub.id, { last_sent_at: new Date(now).toISOString(), last_error: null });
          result.sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            // The device unsubscribed or the app was removed from the Home Screen.
            await storage.deleteTrackerPushSubscription(sub.id);
            result.removed++;
            break;
          }
          await storage.updateTrackerPushSubscription(sub.id, { last_error: String(err.message || err).slice(0, 500) });
          result.failed++;
        }
      }
    }
  }

  for (const t of result.trackers) {
    await storage.setTrackerPushCheckedAt(t.tracker, new Date(now).toISOString());
  }
  return result;
}

// The real sender, from the `web-push` package and VAPID keys in the
// environment (.env on the scheduler host). Throws a setup hint when missing.
function webPushSender(env = process.env) {
  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
    if (!env[key]) throw new Error(`${key} is not set. See docs/tracker-app.md ("Push setup").`);
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
