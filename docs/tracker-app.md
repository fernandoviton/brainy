# Tracker app

A phone-first page at `frontend/tracker/` for tracking a symptom or a rehab programme. It does two jobs:

1. **Fast logging.** A flare takes three taps: pain, trigger, then **Log flare**. A check-in is one tap per area plus Save. Exercises and activities take one tap each.
2. **Reminders** for exercises and movement breaks, on an editable schedule.

The app is **generic**. What a tracker covers lives in its settings, not in code: the body areas you score, the triggers, the activities to compare against (e.g. lift days), the exercises and the reminders. **Knee PT is a preset**: the knee tracker for knee rehab. The condition is in Brainy knowledge `health/knee-pain.md` and the TODO `knee-rehab`. A second tracker (shoulder, back, migraines…) is a new settings row created from the app. It needs no code and no migration.

## Trackers

- Each tracker has an **id** (a slug such as `knee`) and **settings**:

  | Setting | What it's for |
  |---|---|
  | `title` | The tracker's name |
  | `checkin_label` | The check-in's name, e.g. "Morning check-in" |
  | `areas` | Up to 4; scored 0–10 at check-in, and where a flare can be |
  | `triggers` | The flare triggers you pick from |
  | `activities` | Days to compare against, e.g. "Lift day" with "What did you lift?" |
  | `exercises` | Name, how, optional |
  | `reminders` | Text, time, weekdays, on/off |
  | `breaks` | Every N minutes between two times on chosen weekdays, with its own text |
  | `timezone` | The zone reminders fire in |

- `trkNormalizeSettings` in `tracker-core.js` defines and validates this shape.
- **Ids are kept when you rename something**, so old entries stay linked. Entries also store the label at logging time (`item_label`).
- **Opening a tracker:** `?t=<id>` opens a specific one. Without it the app opens the last one used, or the only one there is. With no trackers yet it shows **Start a tracker** with the presets: **Knee PT** and **Blank**.
- **Switching:** a menu in the top bar switches trackers and has **+ New tracker…**.

## Screens

| Tab | What's there |
|---|---|
| **Today** | **Flare now:** pain 0–10, where (any area or "All"; hidden when there's one area), trigger, optional note. **Check-in:** one 0–10 scale per area; the card sits at the top until it's logged, before noon. **Exercises today:** one tap, tap again to undo. One card per **activity**, with its question. A list of today's entries. Every save shows an **Undo** toast. |
| **History** | 14, 30 or 90 days. Tiles: average check-in score (worst area) and flare count. For each activity: flares per day on its days vs other days, and next-day score after its days vs other days. Charts on one shared day axis: check-in score per area (one line each) with activity days shaded, and flares per day. Tap a day for its details. Also a trigger breakdown, a table view, and recent entries with delete. |
| **Settings** | Everything in the settings shape above. Also calendar export and push status. |

**Offline:** an entry that fails because of the network is kept in `localStorage` (one outbox per tracker). It's sent on the next open or when the app comes back to the foreground, and shows as "waiting to sync" until then.

**Demo mode:** `tracker/?demo=1` runs entirely on `localStorage` with no sign-in. `?demo=seed` also creates a knee tracker with 30 days of sample data. Use it for local testing; it never touches Supabase.

## Code

| File | Role |
|---|---|
| `frontend/tracker/tracker-core.js` | Pure logic, shared by the browser and Node: presets, settings validation, entry validation against settings, the time-zone-aware reminder schedule and `trkRemindersDue(from, to]`, the history summary, and the `.ics` export. |
| `frontend/tracker/tracker-store.js` | `trkSupabaseStore`, `trkLocalStore` (demo) and `trkWithOutbox` (offline queue). Each is bound to one tracker id. |
| `frontend/tracker/tracker-chart.js` | Inline-SVG charts. Area colours are a fixed categorical order, checked with the dataviz palette validator: `#C4652A`, `#2F6FA8`, `#3F8A4E`, `#9A4F9E`. |
| `frontend/tracker/app.js` | UI wiring only. Everything is rendered from the current tracker's settings. |
| `frontend/sw-v2.js` | Caches the tracker shell. Also has the `push` / `notificationclick` handlers. |
| `backend/tracker-reminders.js` | The push sender (`sendDueReminders`, covering all trackers) and the real `web-push` sender. |
| `backend/cli.js` → `tracker` | `tracker list`, `log`, `summary` (for agents) and `remind` (the sender). |

Tests: `test/frontend/tracker/*.test.js`, `test/tracker-reminders.test.js`, `test/storage-tracker.test.js` and `test/cli-tracker.test.js`.

## Storage

All three tables are keyed by user, and the first two also by tracker. All use the same per-user RLS as the rest of the schema.

- **`brainy_tracker_entries`**: one row per event. `kind` decides which columns are used:
  - `checkin`: `scores` (JSON, area id → 0–10)
  - `flare`: `pain`, `area`, `trigger`
  - `activity`: `item_id`, `item_label`, `detail`
  - `exercise`: `item_id`, `item_label`

  `entry_date` is the phone's local date.
- **`brainy_tracker_settings`**: one row per (user, tracker). It holds the settings JSON and `push_checked_at` for the sender. The app saves a preset's settings when a tracker is created.
- **`brainy_tracker_push_subscriptions`**: one row per subscribed device, shared by all trackers.

**Why tables, not TODO notes:**
- Charts and comparisons need queryable data. "Flares per day on lift days vs other days" is a `group by`, not a text parse.
- Each tap is one small insert instead of patching a growing text blob that agents also edit.
- Agents read the data with `tracker log` and `tracker summary [--format json]`, and put narrative conclusions in the TODO.

Per-area scores are JSON because the areas differ per tracker. Typed columns per knee would have tied the schema to knees.

## Reminders

### Works today: calendar alarms (no server)

Settings → **Download calendar file (.ics)**. The file has one weekly-recurring event with an alarm for each reminder time, breaks included. Open it on the iPhone to add it to Calendar.

Re-download after changing the schedule. Event UIDs are stable per tracker, so re-importing updates the events. If iOS duplicates them instead, delete the old events first.

### While the app is open

The top bar shows the next reminder. A reminder that comes due while the app is open shows a toast and vibrates where supported.

### Web Push via the Brainy scheduler (built; needs keys to switch on)

```
scheduler timer (15 min) → job "tracker-reminders": node backend/cli.js tracker remind
   for each tracker in brainy_tracker_settings:
     due = trkRemindersDue(settings, max(push_checked_at, now−30min), now]
     keep the latest reminder of each kind (no pile-up of breaks)
   → web-push to every brainy_tracker_push_subscriptions row (VAPID-signed);
     title = tracker title, tap opens tracker/?t=<id>
        404/410 → delete subscription (app removed / unsubscribed)
        other error → last_error on the row
   → each tracker's push_checked_at = now
   a tracker with invalid settings is skipped and the run exits 1 (visible in job runs)
```

- **Half-open windows.** `(from, to]` means consecutive ticks never double-send.
- **Capped lookback.** After a VM outage you don't get a burst of stale nudges.
- **Payload.** It uses the **Declarative Web Push** format (`{"web_push": 8030, "notification": {...}}`). iOS 18.4+ shows it even if the service worker doesn't run. On other browsers, `sw-v2.js` shows the same fields.
- **Limits:**
  - A reminder arrives up to 15 minutes late (tick granularity), and nothing arrives while the VM is down.
  - Push only works in the **Home Screen** install on iOS (16.4+).
  - iOS doesn't support action buttons such as "Done" or "Snooze"; a tap opens the app.

## Hosting more apps

The tracker doesn't get its own GitHub Pages site or deployment. `frontend/` deploys as one static site through the existing workflow, and each app is a folder in it: `capture/`, `browse/…`, `tracker/`. A merge to `main` deploys all of them together.

**What a new app under `frontend/` costs:**

- **Deployment:** nothing. The folder ships with the next deploy.
- **Sign-in:** nothing, *if* Supabase allows a wildcard redirect. Add `https://<user>.github.io/<repo>/**` once in Supabase → Authentication → URL Configuration; it covers every current and future page. Without the wildcard, each new page's URL has to be added by hand.
- **Home Screen icon:** give the folder its own `manifest.json` (`start_url`/`scope` `./`) so it installs as a separate app.
- **Offline shell:** add its files to `SHELL_FILES` in `sw-v2.js`. The single site-wide service worker already covers every folder, including push.
- **Data:** new tables only for a genuinely new kind of data. **A new tracker needs no tables and no code**; it's a new settings row created from the app.

**Previewing a branch before it's merged** would be a separate change: a workflow that also publishes non-`main` branches under `…/preview/<branch>/`. Today, testing before merge means running locally (see `DEVELOPMENT.md`).

## Setup (owner)

### 1. Database (required)

Run `sql/setup.sql` in the Supabase SQL editor. It's idempotent, and only the "Tracker app" block is new: three tables, an index, a trigger and RLS policies.

### 2. Auth redirect (required, once for all apps)

In Supabase → Authentication → URL Configuration, add `https://<user>.github.io/<repo>/**`. For local testing, also add `http://127.0.0.1:8080/**`.

### 3. Deploy (required)

Merge to `main`. The page is at `…/tracker/`, and there's a "Tracker" link in the site nav.

### 4. Install on the iPhone

1. Open `…/tracker/` in Safari.
2. Tap Share → **Add to Home Screen**.
3. Open it from the icon, sign in (the Home Screen app has its own storage), and pick **Knee PT**.

### 5. Push (optional)

1. Generate a VAPID key pair once on the VM: `npx web-push generate-vapid-keys`. Don't commit the private key.
2. Add to the Brainy `.env` on the **scheduler host**:
   ```
   VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>
   VAPID_SUBJECT=mailto:<your email>
   TRACKER_APP_URL=https://<user>.github.io/<repo>/tracker/
   ```
3. Add the **public** key as the GitHub repository variable `VAPID_PUBLIC_KEY` (Settings → Secrets and variables → Actions → Variables). The deploy injects it into `config.js`. For local testing, put `VAPID_PUBLIC_KEY: '…'` in `frontend/config.local.js`.
4. Run `npm install` on the scheduler host to pick up `web-push`.
5. Create the job:
   ```
   node backend/cli.js job create --name tracker-reminders --kind command --trigger schedule \
     --cron "*/15 * * * *" --command "node backend/cli.js tracker remind" --timeout-minutes 5
   ```
6. In the installed app: Settings → **Enable notifications on this device**. This covers every tracker.

To check it's working, run `node backend/cli.js tracker remind` by hand: "Nothing due." means the setup is OK. `job runs tracker-reminders` shows the scheduled runs.

## PWA vs native iOS

**Web Push on a Home Screen PWA (iOS 16.4+; Declarative Web Push since 18.4):**
- It works, but only after Add to Home Screen, and only after you grant permission from a tap inside the installed app.
- There are **no locally scheduled notifications**: no Notification Triggers and no periodic background sync. Every reminder needs a server push at the right moment.
- There are no action buttons, and the app knows nothing about context (it can't tell you've been sitting).
- Deleting the icon kills the subscription.
- Focus modes and Low Power mode may hold notifications back.

**Native or Capacitor app with local notifications (`UNUserNotificationCenter`):**
- Exact, offline, repeating alarms with Done and Snooze actions, and no server.
- Motion data could even drive the movement breaks.
- Costs: building needs a Mac with Xcode, or a cloud Mac CI. A free Apple ID sideload expires every 7 days. TestFlight or App Store needs the $99/year Developer Program, and TestFlight builds expire after 90 days.
- `tracker-core.js` and the Supabase tables carry over to a Capacitor wrapper unchanged.

**Recommendation:**
- Use the PWA for logging and history.
- Use the calendar `.ics` (or iOS Reminders) for reminders now.
- Switch on scheduler push if calendar alarms feel too dumb.
- Go Capacitor only for actionable or context-aware notifications.
