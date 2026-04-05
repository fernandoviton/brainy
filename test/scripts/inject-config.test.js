const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const script = path.join(__dirname, '../../scripts/inject-config.js');
const template = `var CONFIG = CONFIG || {};
CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || '';
CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '';
`;

function writeTempConfig() {
  const tmp = path.join(os.tmpdir(), `test-config-${Date.now()}.js`);
  fs.writeFileSync(tmp, template);
  return tmp;
}

describe('inject-config script', () => {
  test('injects values from environment variables', () => {
    const tmp = writeTempConfig();
    execFileSync('node', [script, tmp], {
      env: {
        ...process.env,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'my-key',
      },
    });
    const result = fs.readFileSync(tmp, 'utf8');
    expect(result).toContain("CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || 'https://example.supabase.co'");
    expect(result).toContain("CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || 'my-key'");
    fs.unlinkSync(tmp);
  });

  test('leaves empty strings when env vars are not set', () => {
    const tmp = writeTempConfig();
    const env = { ...process.env };
    delete env.SUPABASE_URL;
    delete env.SUPABASE_PUBLISHABLE_KEY;
    execFileSync('node', [script, tmp], { env });
    const result = fs.readFileSync(tmp, 'utf8');
    expect(result).toContain("CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || ''");
    expect(result).toContain("CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || ''");
    fs.unlinkSync(tmp);
  });
});
