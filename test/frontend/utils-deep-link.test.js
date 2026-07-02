const fs = require('fs');
const path = require('path');
const vm = require('vm');

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../frontend/utils.js'),
  'utf8'
);

function makeSessionStorage(init) {
  const store = Object.assign({}, init);
  return {
    _store: store,
    getItem: jest.fn((k) => (k in store ? store[k] : null)),
    setItem: jest.fn((k, v) => { store[k] = String(v); }),
    removeItem: jest.fn((k) => { delete store[k]; }),
  };
}

function loadUtils(windowOverrides) {
  const ctx = {
    window: {
      location: { origin: 'https://example.com', pathname: '/browse/todos/', hash: '' },
      history: { replaceState: jest.fn() },
      sessionStorage: makeSessionStorage(),
      ...windowOverrides,
    },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  return ctx;
}

describe('getDeepLink', () => {
  test('returns null when there is no hash', () => {
    const ctx = loadUtils();
    expect(ctx.getDeepLink('todo')).toBeNull();
  });

  test('parses #todo=fix-bug for key "todo"', () => {
    const ctx = loadUtils({ location: { hash: '#todo=fix-bug' } });
    expect(ctx.getDeepLink('todo')).toBe('fix-bug');
  });

  test('returns null when the hash key does not match', () => {
    const ctx = loadUtils({ location: { hash: '#capture=abc' } });
    expect(ctx.getDeepLink('todo')).toBeNull();
  });

  test('returns null for a hash with no key=value shape', () => {
    const ctx = loadUtils({ location: { hash: '#justafragment' } });
    expect(ctx.getDeepLink('todo')).toBeNull();
  });

  test('decodes URI-encoded values', () => {
    const ctx = loadUtils({ location: { hash: '#knowledge=tools%2Fgit%2Frebase.md' } });
    expect(ctx.getDeepLink('knowledge')).toBe('tools/git/rebase.md');
  });

  test('keeps "=" characters inside the value', () => {
    const ctx = loadUtils({ location: { hash: '#todo=a=b' } });
    expect(ctx.getDeepLink('todo')).toBe('a=b');
  });

  test('returns null on malformed percent-encoding instead of throwing', () => {
    const ctx = loadUtils({ location: { hash: '#todo=%E0%A4%A' } });
    expect(ctx.getDeepLink('todo')).toBeNull();
  });
});

describe('setDeepLink', () => {
  test('writes #key=value via history.replaceState', () => {
    const ctx = loadUtils();
    ctx.setDeepLink('todo', 'fix-bug');
    expect(ctx.window.history.replaceState).toHaveBeenCalledWith(null, '', '#todo=fix-bug');
  });

  test('keeps slashes literal in encoded values', () => {
    const ctx = loadUtils();
    ctx.setDeepLink('knowledge', 'tools/git/rebase.md');
    expect(ctx.window.history.replaceState).toHaveBeenCalledWith(null, '', '#knowledge=tools/git/rebase.md');
  });

  test('encodes other special characters', () => {
    const ctx = loadUtils();
    ctx.setDeepLink('todo', 'a b');
    expect(ctx.window.history.replaceState).toHaveBeenCalledWith(null, '', '#todo=a%20b');
  });

  test('clearing (null value) resets the URL to the pathname', () => {
    const ctx = loadUtils();
    ctx.setDeepLink('todo', null);
    expect(ctx.window.history.replaceState).toHaveBeenCalledWith(null, '', '/browse/todos/');
  });

  test('falls back to location.hash when history is unavailable', () => {
    const ctx = loadUtils({ history: undefined, location: { pathname: '/browse/todos/', hash: '' } });
    ctx.setDeepLink('todo', 'fix-bug');
    expect(ctx.window.location.hash).toBe('#todo=fix-bug');
  });
});

// The OAuth sign-in redirect drops the URL hash, so the deep link is stashed
// in sessionStorage before redirecting and recovered afterwards.
describe('deep link stash (OAuth round-trip)', () => {
  test('stashDeepLink stores the current hash in sessionStorage', () => {
    const ctx = loadUtils({ location: { hash: '#todo=fix-bug' } });
    ctx.stashDeepLink();
    expect(ctx.window.sessionStorage.setItem).toHaveBeenCalledWith('brainy-deep-link', '#todo=fix-bug');
  });

  test('stashDeepLink does nothing when there is no hash', () => {
    const ctx = loadUtils({ location: { hash: '' } });
    ctx.stashDeepLink();
    expect(ctx.window.sessionStorage.setItem).not.toHaveBeenCalled();
  });

  test('getStashedDeepLink returns the stashed value for the key and clears the stash', () => {
    const ctx = loadUtils({ sessionStorage: makeSessionStorage({ 'brainy-deep-link': '#todo=fix-bug' }) });
    expect(ctx.getStashedDeepLink('todo')).toBe('fix-bug');
    expect(ctx.window.sessionStorage.removeItem).toHaveBeenCalledWith('brainy-deep-link');
  });

  test('getStashedDeepLink returns null when nothing is stashed', () => {
    const ctx = loadUtils();
    expect(ctx.getStashedDeepLink('todo')).toBeNull();
  });

  test('getStashedDeepLink returns null for a key mismatch', () => {
    const ctx = loadUtils({ sessionStorage: makeSessionStorage({ 'brainy-deep-link': '#capture=abc' }) });
    expect(ctx.getStashedDeepLink('todo')).toBeNull();
  });

  test('stash helpers tolerate a missing sessionStorage', () => {
    const ctx = loadUtils({ sessionStorage: undefined, location: { hash: '#todo=fix-bug' } });
    expect(() => ctx.stashDeepLink()).not.toThrow();
    expect(ctx.getStashedDeepLink('todo')).toBeNull();
  });
});
