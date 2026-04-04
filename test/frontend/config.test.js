const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadScript(filename) {
  const code = fs.readFileSync(path.join(__dirname, '../../frontend', filename), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx;
}

describe('frontend config', () => {
  test('CONFIG object exists with expected keys', () => {
    const ctx = loadScript('config.js');
    expect(ctx.CONFIG).toBeDefined();
    expect(ctx.CONFIG).toHaveProperty('SUPABASE_URL');
    expect(ctx.CONFIG).toHaveProperty('SUPABASE_PUBLISHABLE_KEY');
  });

  test('CONFIG values are strings', () => {
    const ctx = loadScript('config.js');
    expect(typeof ctx.CONFIG.SUPABASE_URL).toBe('string');
    expect(typeof ctx.CONFIG.SUPABASE_PUBLISHABLE_KEY).toBe('string');
  });
});

describe('Supabase client initialization', () => {
  test('createClient called with CONFIG values when app loads', () => {
    const mockCreateClient = jest.fn().mockReturnValue({
      auth: { onAuthStateChange: jest.fn(), signInWithOAuth: jest.fn() },
    });

    const ctx = {
      CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
      supabase: { createClient: mockCreateClient },
      document: {
        getElementById: jest.fn().mockReturnValue({ addEventListener: jest.fn(), style: {} }),
        querySelector: jest.fn().mockReturnValue({ addEventListener: jest.fn(), style: {} }),
      },
      window: { location: { origin: '', pathname: '' } },
    };
    vm.createContext(ctx);

    const appCode = fs.readFileSync(path.join(__dirname, '../../frontend/app.js'), 'utf8');
    vm.runInContext(appCode, ctx);

    expect(mockCreateClient).toHaveBeenCalledWith('https://test.supabase.co', 'test-key');
  });
});
