const fs = require('fs');
const path = require('path');

const configPath = process.argv[2] || 'frontend/config.js';
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const vapid = process.env.VAPID_PUBLIC_KEY || '';

let content = fs.readFileSync(configPath, 'utf8');
content = content.replace(
  "CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || ''",
  `CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || '${url}'`
);
content = content.replace(
  "CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || ''",
  `CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '${key}'`
);
content = content.replace(
  "CONFIG.VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || ''",
  `CONFIG.VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || '${vapid}'`
);
fs.writeFileSync(configPath, content);
console.log('Config injected.');
