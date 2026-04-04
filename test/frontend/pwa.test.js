const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '../../frontend');

describe('manifest.json', () => {
  let manifest;

  beforeAll(() => {
    manifest = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'manifest.json'), 'utf8'));
  });

  test('has required fields', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBeTruthy();
    expect(manifest.icons).toBeDefined();
  });

  test('icons array has valid entries', () => {
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      expect(icon.src).toBeTruthy();
      expect(icon.sizes).toMatch(/^\d+x\d+$/);
      expect(icon.type).toBe('image/png');
    }
  });

  test('includes 192x192 and 512x512 icons', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });
});

describe('service worker', () => {
  test('sw.js exists', () => {
    expect(fs.existsSync(path.join(FRONTEND, 'sw.js'))).toBe(true);
  });
});
