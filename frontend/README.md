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

## Tests

From the project root:
```bash
npx jest test/frontend/
```
