const fs = require('fs');
const path = require('path');

const configPath = process.argv[2] || 'frontend/config.js';
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';

let content = fs.readFileSync(configPath, 'utf8');
content = content.replace(
  "CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || ''",
  `CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || '${url}'`
);
content = content.replace(
  "CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || ''",
  `CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '${key}'`
);
fs.writeFileSync(configPath, content);
console.log('Config injected.');
