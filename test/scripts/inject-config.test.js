const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const script = path.join(__dirname, '../../scripts/inject-config.js');
const template = `var CONFIG = CONFIG || {};
CONFIG.SUPABASE_URL = CONFIG.SUPABASE_URL || '';
CONFIG.SUPABASE_PUBLISHABLE_KEY = CONFIG.SUPABASE_PUBLISHABLE_KEY || '';
CONFIG.VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || '';
`;

// Name must not collide with other suites running in parallel jest workers
// (validate-config.test.js also writes temp configs to os.tmpdir()).
let seq = 0;
function writeTempConfig() {
  const tmp = path.join(os.tmpdir(), `inject-config-${process.pid}-${Date.now()}-${seq++}.js`);
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

  test('injects the optional VAPID public key for the PT app push', () => {
    const tmp = writeTempConfig();
    execFileSync('node', [script, tmp], { env: { ...process.env, VAPID_PUBLIC_KEY: 'BPub-key_1' } });
    expect(fs.readFileSync(tmp, 'utf8')).toContain("CONFIG.VAPID_PUBLIC_KEY = CONFIG.VAPID_PUBLIC_KEY || 'BPub-key_1'");
    fs.unlinkSync(tmp);
  });
});
