# Frontend Caching & Service Worker Strategy

## Current approach: Network-first

`sw.js` uses a **network-first** strategy: always fetch from the network, fall back to cache when offline. This means changes are visible on a normal reload without force-resetting.

Two other mechanisms ensure new SW versions activate immediately:
- `skipWaiting()` in `install` — new SW takes over without waiting for tabs to close
- `clients.claim()` in `activate` — SW controls existing tabs right away
- Old caches are deleted in `activate` when `CACHE_NAME` is bumped

## Why not cache-first?

Cache-first is faster (instant load) but requires **filename hashing** to see updates:

```
app.js  →  app.a3f9c1.js   (old, cached forever)
app.js  →  app.7b2e44.js   (new, fetched fresh)
```

The HTML is served with `Cache-Control: no-cache` so the browser always fetches fresh HTML, which in turn references the new hashed filenames. Build tools (Vite, Webpack, Parcel) do this automatically.

Since this project has no build step, cache-first would mean never seeing updates without a force-reset. Network-first is the right tradeoff here.

## If a build step is added in the future

Switch `sw.js` to cache-first on assets + short TTL on `index.html`, and let the build tool handle filename hashing. That gives instant loads AND automatic updates.
