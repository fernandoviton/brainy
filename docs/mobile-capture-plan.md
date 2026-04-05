# Mobile Capture PWA

## Goal

Capture raw thoughts, TODOs, images, and docs from iOS for later processing in Brainy.

## Key Decisions

- **Captures are not TODOs.** They're raw brain dumps — could become TODOs, knowledge, nothing, or multiple things. Separate table, separate semantics.
- **PWA approach** (not iOS Shortcut + Edge Function). A web app can reuse Supabase's client-side Google OAuth — no edge function, no extra secrets, no custom auth.
- **Hosting:** GitHub Pages (monorepo, deployed via GitHub Actions from `frontend/`).
- **Framework:** Vanilla HTML/JS. Revisit if scope grows beyond capture.
- **OAuth:** Supabase JS client handles Google OAuth via redirect. Redirect URL configured in Supabase dashboard.
- **Offline support:** Online-only for now.
- **Scope:** Capture only — no list/view in the PWA yet.

## Architecture

```
iPhone browser (PWA)
  → Google OAuth via Supabase client-side auth
  → Direct INSERT into brainy_captures
  → RLS enforces user_id automatically
```

No edge function needed. The PWA talks directly to Supabase using `@supabase/supabase-js`.

## Current State (Implemented)

- Google OAuth sign-in via Supabase
- Text capture form (insert into `brainy_captures`)
- PWA manifest (`manifest.json`) with home screen icons
- Service worker (`sw.js`) with cache-first strategy for app shell
- GitHub Pages deployment via GitHub Actions

## Not Yet Implemented

- **Camera/file capture:** Direct camera access via `<input type="file" capture="environment">` + file picker
- **Image resizing:** Client-side resize of large iPhone photos before upload (notify user when resizing)
- **Offline queueing:** Queue captures in localStorage/IndexedDB when offline, sync when back online
- **File uploads:** Upload to `brainy_files` Supabase Storage bucket, link via `brainy_capture_media`
