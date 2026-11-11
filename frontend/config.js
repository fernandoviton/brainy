// Defaults — override in config.local.js (gitignored)
var CONFIG = CONFIG || {};
CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || '';
CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '';
// Web Push public key for the tracker app (frontend/tracker/). Optional; empty = push off.
CONFIG.VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || '';
