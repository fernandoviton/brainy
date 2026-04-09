# Capture PWA Architecture

## Overview

The capture PWA is a vanilla HTML/JS progressive web app hosted on GitHub Pages. It talks directly to Supabase — no backend server, no edge functions.

```
iPhone browser (PWA)
  → Google OAuth via Supabase client-side auth
  → resize.js: client-side image resize (Canvas API)
  → capture/upload.js: upload files to Supabase Storage, insert DB records
  → capture/app.js: UI wiring (DOM events, status display)
  → RLS enforces user_id on all tables and storage
```

## File Structure

| File | Responsibility |
|------|---------------|
| `capture/app.js` | UI only: auth flow, form events, button states, status messages |
| `capture/upload.js` | Data flow: resize → storage upload → capture insert → media insert |
| `resize.js` | Image resize via `createImageBitmap` + Canvas + `toBlob` |
| `index.html` | Form markup, script loading order |
| `capture/app.css` | Styles |
| `config.js` / `config.local.js` | Supabase URL + key (injected at deploy time) |

## Key Decisions

### Upload-first flow
Files upload to Supabase Storage *before* any DB rows are inserted. If an upload fails, nothing is written to the DB (no orphan capture records). If the DB insert fails after upload, orphan blobs in storage are harmless and cleanable.

### No `capture="environment"` on file input
Omitting the `capture` attribute lets iOS present its standard chooser sheet (camera, photo library, files). Adding `capture="environment"` would skip the chooser and go straight to the rear camera, which is too restrictive.

### `accept="*/*"` on file input
The file picker is not restricted to images — users can attach any file type. The resize logic only activates for `image/*` content types.

### Image resize strategy
- `createImageBitmap` decodes the image, Canvas draws it scaled, `toBlob('image/jpeg', 0.85)` produces the output
- Max 1920px on the longest side (preserves aspect ratio)
- Graceful fallback: if `createImageBitmap` is unavailable (iOS 14 and older), the original file uploads unresized
- `bitmap.close()` is called immediately after drawing to free memory

### File path format
`{user_id}/captures/{Date.now()}-{sanitized_filename}` — timestamp prefix prevents collisions. Original filename preserved in the `brainy_capture_media` record; sanitized version used only in the storage path.

### Three-file split (resize / upload / app)
- `resize.js` and `capture/upload.js` are pure logic with no DOM dependencies
- `capture/upload.js` accepts `resizeFn` as a parameter for dependency injection in tests
- `capture/app.js` is UI wiring only — delegates all data work to `uploadCapture()`
- This makes `capture/upload.js` testable with plain Jest mocks (no VM context needed)

### Error message mapping
Browser errors like `"Failed to fetch"` are cryptic. The app maps known patterns to user-friendly messages:
- `/fetch/i` → "can't find the file, please try again"
- `/network/i` → "check your internet connection"
- Everything else passes through as-is

## Database Schema

```
brainy_captures
  id, user_id, text (nullable), processed_at, created_at

brainy_capture_media
  id, user_id, capture_id (FK cascade), filename, content_type, storage_path, created_at

brainy_files (Supabase Storage bucket, private)
  RLS: users can only access {uid}/ prefix
```

Text is nullable to support file-only captures. Cascade delete on `capture_id` ensures media records are cleaned up when a capture is deleted.

## Testing

| Test file | Strategy |
|-----------|----------|
| `test/frontend/resize.test.js` | VM context with mocked `createImageBitmap` and Canvas |
| `test/frontend/capture/upload.test.js` | Plain Jest mocks (no VM) — mocks `db.from()`, `db.storage.from()` |
| `test/frontend/capture/app.test.js` | VM context with mocked DOM, mocked `uploadCapture` injected as global |
