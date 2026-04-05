const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const script = path.join(__dirname, '../../scripts/validate-config.js');

function writeTempConfig(content) {
  const tmp = path.join(os.tmpdir(), `test-config-${Date.now()}.js`);
  fs.writeFileSync(tmp, content);
  return tmp;
}

describe('validate-config script', () => {
  test('passes when both values are set', () => {
    const tmp = writeTempConfig(`
      var CONFIG = {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'test-key',
      };
    `);
    const out = execFileSync('node', [script, tmp], { encoding: 'utf8' });
    expect(out).toContain('Config validation passed');
    fs.unlinkSync(tmp);
  });

  test('fails when SUPABASE_URL is empty', () => {
    const tmp = writeTempConfig(`
      var CONFIG = {
        SUPABASE_URL: '',
        SUPABASE_PUBLISHABLE_KEY: 'test-key',
      };
    `);
    expect(() => execFileSync('node', [script, tmp], { encoding: 'utf8' })).toThrow();
    fs.unlinkSync(tmp);
  });

  test('fails when SUPABASE_PUBLISHABLE_KEY is empty', () => {
    const tmp = writeTempConfig(`
      var CONFIG = {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: '',
      };
    `);
    expect(() => execFileSync('node', [script, tmp], { encoding: 'utf8' })).toThrow();
    fs.unlinkSync(tmp);
  });

  test('fails when both values are empty', () => {
    const tmp = writeTempConfig(`
      var CONFIG = {
        SUPABASE_URL: '',
        SUPABASE_PUBLISHABLE_KEY: '',
      };
    `);
    expect(() => execFileSync('node', [script, tmp], { encoding: 'utf8' })).toThrow();
    fs.unlinkSync(tmp);
  });
});
