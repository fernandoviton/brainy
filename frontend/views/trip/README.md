# Trip planner view

A page for reviewing a trip while it's being planned: decisions with options side by side, votes per person, a day-by-day calendar with whole-itinerary alternatives (Plan A / Plan B), a map, a budget roll-up, book-by deadlines, and comments for Brainy.

```
https://fernandoviton.github.io/brainy/views/trip/#entry=travel/trips/<trip>/planner.md
```

- **Data** lives in Brainy, in the knowledge entry named by `#entry=` (a trip folder works too: `#entry=travel/trips/<trip>` means its `planner.md`). The entry is a short markdown preamble followed by one ```` ```json ```` block. Nothing trip-specific is stored in the repo.
- **Trip list:** with no `#entry=` (the nav's **Trips** link), the page lists every knowledge entry named `planner.md` and links to each.
- **Auth** is the site's Google sign-in. The page talks to `brainy_knowledge` directly with the signed-in Supabase client (RLS: your own rows only). The OAuth redirect drops the URL hash, so the entry path is stashed in `sessionStorage` before sign-in and restored after.
- **Writes**: every change is an op (`core.applyOp`). `entry-store.js` re-reads the entry, applies the op, and updates with `eq('updated_at', <value read>)`. If no row changed, someone else (the CLI, an agent, another tab) saved in between, so it re-reads and re-applies, up to 4 tries, then reports "kept changing… reload". Ops from one page are queued one at a time.
- **Hash routes**: `#entry=<path>` plus one of `&tab=<tab>`, `&research=<knowledge path>`, and optionally `&decision=<id>` (opens the decision drawer).
- **Mock mode**: on `localhost`/`127.0.0.1` with no Supabase config (no `config.local.js`), the page runs against `fixture.js`, a fake demo plan kept in memory. The repo is public, so the fixture must stay fake: no real names, bookings, prices or places.

Run locally: `cd frontend && python3 -m http.server 8080 --bind 127.0.0.1`, then open `http://127.0.0.1:8080/views/trip/` (mock mode unless `config.local.js` exists).

## Files

| File | Role |
|---|---|
| `entry-store.js` | Generic: parse/serialize a "preamble + json block" knowledge entry, `load`, `applyOp` (optimistic concurrency + retry), `get`, `list`. No trip logic; reusable by another view. |
| `core.js` | Pure trip logic: dates, headcount, costs, budget, scenarios, ops, hash routing |
| `app.js`, `app.css`, `index.html` | The UI (plain DOM; Leaflet, marked, DOMPurify and supabase-js from CDNs) |
| `mock-client.js` | In-memory stand-in for the Supabase query shapes the store uses (mock mode and tests). Also backs the TODOs page (`browse/todos/`) via `{ table: 'brainy_todos', tables: {...} }` (extra tables are select-only). |
| `fixture.js` | Fake demo plan for mock mode |

Tests: `test/frontend/views/trip-core.test.js`, `trip-entry-store.test.js`, `trip-page.test.js` (jsdom smoke test of the page in mock mode and signed-in mode).

## Plan shape

```jsonc
{
  "schema": 1,
  "trip": { "title", "start", "end", "knowledgePath", "todo", "researchPrefixes": [] },
  "settings": { "partySize": 6, "rooms": 3, "eurToUsd": 1.16, "people": ["Alex", "Sam"] },
  "budget": { "targets": [{ "label", "usd" | "usdLow"/"usdHigh", "categories"? }], "estimates": [], "fixed": [] },
  "travelers": [{ "id", "name", "count", "from", "to", "status": "booked|likely|tbd" }],
  "bases": [{ "id", "name", "short", "from", "to" /* nights from..to-1 */, "color", "placeId", "decisionId" }],
  "places": [{ "id", "name", "lat", "lng", "kind" }],
  "legs": [{ "date", "label", "path": ["placeId"], "decisionId" }],
  "days": [{ "date", "items": [{ "slot": "travel|day|am|pm|eve", "title", "status"?, "decisionId"? }] }],
  "decisions": [{
    "id", "title", "category": "lodging|transport|activity|food|strategy", "dates": [],
    "status": "open|leaning|decided|booked|dropped", "multi"?: true, "chosen": [], "recommended": "optionId",
    "question", "context" /* markdown */, "agentTake", "refs": ["knowledge path"],
    "nights"?, "rooms"?, "people"?, "shareOfGroup"?, "excludeFromBudget"?,
    "options": [{
      "id", "title", "summary", "pros": [], "cons": [], "links": [{ "label", "url" }],
      "cost": { "low", "high", "currency": "EUR|USD", "unit": "room-night|person|group|vehicle|party|total", "note" },
      "budgetCategory": "lodging|transport|guides|tickets|activities|food",
      "status": "candidate|shortlisted|rejected", "votes": { "Alex": 1 }, "lat"?, "lng"?,
      "agentTake"?, "verified"?, "source"?, "addedBy"?,
      "scenario"?: { "bases": [], "days": [] }   // whole-itinerary alternative (see withScenario)
    }]
  }],
  "tasks": [{ "id", "kind": "deadline|waiting|todo|question", "title", "short"?, "due"?, "owner", "decisionId"?, "done" }],
  "notes": [{ "id", "kind": "risk|tip|idea", "title", "body", "decisionId"? }],
  "comments": [{ "id", "decisionId", "optionId", "who", "text", "at", "resolved" }],
  "log": [{ "at", "who", "text" }]
}
```

**Our cost** for an option: `room-night` × nights × rooms; `person` × people; `group`/`vehicle` × `shareOfGroup` (default 1); `party`/`total` as-is. The budget counts chosen options as *committed*, and the chosen or leading option (most 👍, else `recommended`) as *projected*.

## Brainy's side

Owner comments (`resolved: false`) and options with `addedBy` are review input. On the next planning session, Brainy acts on them (research, update options, move findings into the prose entries), then resolves the comments. To edit: `knowledge get <trip>/planner.md`, change the JSON, and upsert the whole entry with `--file`. A CLI upsert bumps `updated_at`, so an open planner page re-applies its next op on top of it rather than overwriting it.
