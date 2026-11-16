# Brainy Capture — Frontend

A PWA for capturing thoughts from mobile. Deployed via GitHub Pages.

## Local Development

1. **Create `config.local.js`** (gitignored) with your Supabase credentials:
   ```js
   var CONFIG = {
       SUPABASE_URL: 'https://your-project.supabase.co',
       SUPABASE_PUBLISHABLE_KEY: 'your-anon-key',
   };
   ```

2. **Start a local server** from the `frontend/` directory:
   ```bash
   # Python
   python -m http.server 8000

   # Node (npx, no install)
   npx serve .
   ```

3. **Open** `http://localhost:8000` in your browser.

4. **Google OAuth redirect**: For sign-in to work locally, add `http://localhost:8000` as an allowed redirect URL in your Supabase dashboard (Authentication > URL Configuration).

## Deep links

The browse pages support hash-based deep links (they work on static hosting — no server routing needed):

| Page | Format | Example |
|------|--------|---------|
| TODOs | `browse/todos/#todo=<name>` | `browse/todos/#todo=fix-bug` |
| Captures | `browse/captures/#capture=<id>` | `browse/captures/#capture=3f2a…` |
| Knowledge | `browse/knowledge/#knowledge=<path>` | `browse/knowledge/#knowledge=tools/git/rebase.md` |
| TODO board | `views/board/[#priority=<P0-P3>][&category=<c>][&q=<text>]` | `views/board/#priority=P1&q=roof` |
| Trip planner | `views/trip/#entry=<trip>/planner.md[&tab=<tab>][&decision=<id>]` | `views/trip/#entry=travel/trips/demo/planner.md&tab=budget` |

HTML attachments (knowledge attachments, TODO collateral, capture media) open in `browse/viewer/#path=<storage path>&name=<filename>` rather than at their signed URL: Supabase Storage serves HTML as `text/plain` + `nosniff`, so the raw link shows source. The viewer downloads the file with the signed-in client and renders it in an `<iframe sandbox="allow-scripts …">` via `srcdoc` — never `allow-same-origin`, so the attachment's scripts can't read the Supabase session. A "Download original" link serves the raw file.

On load the linked item is expanded (todos/knowledge) or highlighted (captures) and scrolled into view. If a linked todo or capture isn't in the default filter, it is fetched directly and shown on top. Expanding/collapsing a todo or knowledge card updates the URL hash so the current view can be copied as a link.

The trip planner (`views/trip/`) reads and writes its knowledge entry directly; see `views/trip/README.md`. Its `#entry=` hash is lost in the Google OAuth redirect, so the page stashes it in `sessionStorage` before signing in and restores it afterwards.

The TODO board (`views/board/`) is an alternative to the TODOs page: live TODOs in Inbox / Active / Later / Scheduled columns, drag and drop plus a per-card status control (for phones), quick priority and due edits, filters in the hash, and a due strip. It writes `brainy_todos` directly, so `core.js` enforces the CLI's rules in the browser: `scheduled_date` is set if and only if the status is `scheduled` (moving to Scheduled asks for a date, moving off clears it), and only status, priority and due are editable (no archive or delete). Failed saves re-fetch the board. Mock mode on localhost uses `fixture.js` and the trip view's `mock-client.js`.

## Tests

From the project root:
```bash
npx jest test/frontend/
```
