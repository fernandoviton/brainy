const fs = require('fs');
const vm = require('vm');

const configPath = process.argv[2] || 'frontend/config.js';
const code = fs.readFileSync(configPath, 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const errors = [];
if (!ctx.CONFIG.SUPABASE_URL) {
  errors.push('SUPABASE_URL is empty after config injection.\n  Set the SUPABASE_URL repository variable in GitHub Settings > Secrets and variables > Actions.');
}
if (!ctx.CONFIG.SUPABASE_PUBLISHABLE_KEY) {
  errors.push('SUPABASE_PUBLISHABLE_KEY is empty after config injection.\n  Set the SUPABASE_PUBLISHABLE_KEY repository variable in GitHub Settings > Secrets and variables > Actions.');
}

if (errors.length) {
  errors.forEach(e => console.error('ERROR: ' + e));
  process.exit(1);
}
console.log('Config validation passed.');
