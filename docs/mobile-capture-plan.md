# Mobile Capture PWA — Planning Document

## Goal

Capture raw thoughts, TODOs, images, and docs from iOS for later processing in Brainy.

## Key Decisions Made

- **Captures are not TODOs.** They're raw brain dumps — could become TODOs, knowledge, nothing, or multiple things. Separate table, separate semantics.
- **PWA approach** (not iOS Shortcut + Edge Function). A web app can reuse Supabase's client-side Google OAuth — no edge function, no extra secrets, no custom auth. Simpler infra and starts the web UI foundation the user will want anyway.

## Architecture

```
iPhone browser (PWA)
  → Google OAuth via Supabase client-side auth
  → Direct INSERT into brainy_captures / brainy_capture_media
  → File uploads to brainy_files bucket
  → RLS enforces user_id automatically
```

No edge function needed. The PWA talks directly to Supabase using `@supabase/supabase-js`.

## PWA — Open Questions

- **Hosting**: **Decided — GitHub Pages** (monorepo, deployed via GitHub Actions from `frontend/`). Same pattern as `listlet-shared`.
- **Framework**: Vanilla HTML/JS? Preact/React? Keep it minimal — it's a capture form, not a dashboard.  Vanilla to start.  Maybe when we do more than capture we revisit.
- **OAuth flow on mobile**: Supabase JS client handles Google OAuth via redirect. Need to configure the redirect URL in Supabase dashboard for the PWA's domain.
- **PWA install experience**: manifest.json, service worker for offline queueing, home screen icon.
- **Camera/file capture UX**: Direct camera access via `<input type="file" capture="environment">`? Or just file picker?  Definitely include camera.
- **Offline support**: Queue captures in localStorage/IndexedDB when offline, sync when back online? Or keep it simple (online-only) for v1?  online only
- **Image resizing**: Large iPhone photos can be 5-10MB. Resize client-side before upload? Yes - and notify when doing it in the web app.
- **Scope of v1**: Just capture, or also list/view captures in the PWA?  Just capture.
