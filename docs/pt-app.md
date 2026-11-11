# Knee PT app

A phone-first page at `frontend/pt/` for knee rehab. It does two jobs:

1. **Fast logging.** A flare takes three taps: pain, trigger, then **Log flare** (the knee defaults to right). The morning check-in is two taps plus Save. Exercises and lift days take one tap each.
2. **Reminders** for the daily PT stretch and for sitting breaks. The schedule is editable in the app.

The condition and the rehab plan are in Brainy: knowledge `health/knee-pain.md` and TODO `knee-rehab`.

## Screens

| Tab | What's there |
|---|---|
| **Today** | **Flare now:** pain 0–10, knee (R/L/both), trigger, optional note. **Morning check-in:** right and left, 0–10; this card sits at the top until it's logged, before noon. **Exercises today:** one tap per exercise, tap again to undo. **Lift day:** what you lifted. A list of today's entries. Every save shows an **Undo** toast. |
| **History** | 14, 30 or 90 days. Tiles: average morning pain (worse knee), flare count, flares per day on lift days vs other days, and next-morning pain after lift days vs other days. Charts on one shared day axis: morning pain per knee with lift days shaded, and flares per day. Tap a day for its details. Also a trigger breakdown, a table view, and recent entries with delete. |
| **Settings** | Exercises (name, how, optional). Reminders (text, time, weekdays, on/off). Sitting breaks (every N minutes between two times on chosen weekdays). Time zone. Calendar export and push status. |

**Offline:** an entry that fails because of the network is kept in `localStorage` (the "outbox"). It's sent on the next open or when the app comes back to the foreground, and it shows as "waiting to sync" until then.

**Demo mode:** `pt/?demo=1` runs entirely on `localStorage` with no sign-in. `?demo=seed` also fills in 30 days of sample data. Use it for local testing; it never touches Supabase.

## Code

| File | Role |
|---|---|
| `frontend/pt/pt-core.js` | Pure logic, shared by the browser and Node. Covers entry validation, settings normalisation, the reminder schedule (time-zone aware via `Intl`), `ptRemindersDue(from, to]`, the history summary, and the `.ics` export. |
| `frontend/pt/pt-store.js` | `ptSupabaseStore`, `ptLocalStore` (demo), and `ptWithOutbox` (offline queue). |
| `frontend/pt/pt-chart.js` | Inline-SVG charts. Colours were checked with the dataviz palette validator: right `#C4652A`, left `#2F6FA8`. |
| `frontend/pt/app.js` | UI wiring only. |
| `frontend/sw-v2.js` | Caches the PT shell. Also has the `push` / `notificationclick` handlers. |
| `backend/pt-reminders.js` | The push sender (`sendDueReminders`) plus the real `web-push` sender. |
| `backend/cli.js` → `pt` | `pt log`, `pt summary` (for agents), and `pt remind` (the sender). |

Tests: `test/frontend/pt/*.test.js`, `test/pt-reminders.test.js`, `test/storage-pt.test.js`, `test/cli-pt.test.js`.

## Storage: why tables, not the TODO notes

Entries go in **`brainy_pt_entries`**, one row per event. The `kind` field (`morning` / `flare` / `lift` / `exercise`) decides which typed columns are filled.

I chose this over appending lines to the `knee-rehab` TODO notes because:
- **Charts and correlations need typed, queryable data.** "Flares per day on lift days vs other days" is a `group by`. In notes it would be a fragile text parse.
- **Speed and safety.** Each tap is a single small insert, protected by RLS and check constraints. Appending to notes would mean re-sending or patching a growing text blob on every tap, and that blob is shared with agents.
- **Agents can still read it.** `node backend/cli.js pt log --days 14` and `pt summary --days 30 [--format json]`. An agent can then write conclusions into the `knee-rehab` TODO, which is where narrative belongs.

`entry_date` stores the phone's local date, so "per day" never depends on the server's time zone.

**`brainy_pt_settings`** (one row per user) holds the editable exercises and schedule as JSON, plus `push_checked_at` for the sender. The app saves the defaults on first run.

**`brainy_pt_push_subscriptions`** stores one row per subscribed device.

All three tables use the same per-user RLS as the rest of the schema (`auth.uid() = user_id`).

## Reminders

### Works today: calendar alarms (no server)

Settings → **Download calendar file (.ics)**. The file has one weekly-recurring event with an alarm for each reminder time, sitting breaks included. Open it on the iPhone to add it to Calendar.

Re-download after changing the schedule. Event UIDs are stable, so re-importing updates the events. If iOS duplicates them instead, delete the "Knee PT" events first.

Fallback: plain repeating reminders in the iOS Reminders app.

### While the app is open

The top bar shows the next reminder. A reminder that comes due while the app is open shows a toast and vibrates the phone where supported.

### Web Push via the Brainy scheduler (built; needs keys to switch on)

```
scheduler timer (15 min) → job "pt-reminders": node backend/cli.js pt remind
   → read brainy_pt_settings (schedule + push_checked_at)
   → due = ptRemindersDue(settings, max(push_checked_at, now−30min), now]
   → keep the latest reminder of each kind (no pile-up of sitting breaks)
   → web-push to every brainy_pt_push_subscriptions row (VAPID-signed)
        404/410 → delete subscription (app removed / unsubscribed)
        other error → last_error on the row
   → push_checked_at = now
```

- **Half-open windows.** `(from, to]` means consecutive ticks never double-send.
- **Capped lookback.** The 30-minute cap means a VM outage doesn't produce a burst of stale nudges afterwards.
- **Payload.** It uses the **Declarative Web Push** format (`{"web_push": 8030, "notification": {...}}`). iOS 18.4+ displays it even if the service worker doesn't run. On other browsers, `sw-v2.js` shows the same fields.
- **Limits:**
  - A reminder arrives up to 15 minutes late (tick granularity), and nothing arrives while the VM is down.
  - Push only works in the **Home Screen** install on iOS (16.4+).
  - iOS doesn't support action buttons such as "Done" or "Snooze"; a tap opens the app.

## Setup (owner)

### 1. Database (required)

Run `sql/setup.sql` in the Supabase SQL editor. It's idempotent, and only the "Knee PT app" block is new: three tables, an index, a trigger and RLS policies.

### 2. Auth redirect (required)

In Supabase → Authentication → URL Configuration, add the PT page to the allowed redirect URLs, unless a wildcard already covers it:
- `https://<user>.github.io/<repo>/pt/`
- `http://127.0.0.1:8080/pt/` for local testing

### 3. Deploy (required)

Merge to `main`; the GitHub Pages workflow deploys `frontend/`. The page is at `…/pt/`, and there's a "Knee" link in the site nav.

### 4. Install on the iPhone

1. Open `…/pt/` in Safari.
2. Tap Share → **Add to Home Screen**.
3. Open it from the icon and sign in. The Home Screen app has its own storage, so you sign in again there.

### 5. Push (optional)

1. Generate a VAPID key pair once on the VM: `npx web-push generate-vapid-keys`. Don't commit the private key.
2. Add to the Brainy `.env` on the **scheduler host**:
   ```
   VAPID_PUBLIC_KEY=<public key>
   VAPID_PRIVATE_KEY=<private key>
   VAPID_SUBJECT=mailto:<your email>
   PT_APP_URL=https://<user>.github.io/<repo>/pt/
   ```
3. Add the **public** key as the GitHub repository variable `VAPID_PUBLIC_KEY` (Settings → Secrets and variables → Actions → Variables). The deploy injects it into `config.js`. For local testing, put `VAPID_PUBLIC_KEY: '…'` in `frontend/config.local.js`.
4. Run `npm install` on the scheduler host to pick up `web-push`.
5. Create the job:
   ```
   node backend/cli.js job create --name pt-reminders --kind command --trigger schedule \
     --cron "*/15 * * * *" --command "node backend/cli.js pt remind" --timeout-minutes 5
   ```
6. In the installed app: Settings → **Enable notifications on this device**.

To check it's working, run `node backend/cli.js pt remind` by hand: "Nothing due." means the setup is OK. `job runs pt-reminders` shows the scheduled runs.

## PWA vs native iOS

**Web Push on a Home Screen PWA (iOS 16.4+; Declarative Web Push since 18.4):**
- It works, but only after Add to Home Screen, and only after you grant permission from a tap inside the installed app.
- There are **no locally scheduled notifications**: no Notification Triggers and no periodic background sync. Every reminder needs a server push at the right moment.
- There are no action buttons, and the app knows nothing about context (it can't tell you've been sitting).
- Deleting the icon kills the subscription.
- Focus modes and Low Power mode may hold notifications back, as with any notification.

**Native or Capacitor app with local notifications (`UNUserNotificationCenter`):**
- Exact, offline, repeating alarms with Done and Snooze actions, and no server.
- Motion data could even drive sitting reminders.
- Costs: building needs a Mac with Xcode, or a cloud Mac CI. A free Apple ID sideload expires every 7 days. TestFlight or App Store needs the $99/year Developer Program, and TestFlight builds expire after 90 days.
- The PWA's logic (`pt-core.js`) and Supabase tables carry over to a Capacitor wrapper unchanged.

**Recommendation:**
- Use the PWA for logging and history.
- Use the calendar `.ics` (or iOS Reminders) for reminders now.
- Switch on scheduler push if calendar alarms feel too dumb.
- Go Capacitor only if you want actionable or context-aware notifications and are willing to take on the Mac and Apple-account overhead.
