const fs = require('fs');
const path = require('path');
const vm = require('vm');

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../frontend/utils.js'),
  'utf8'
);

function loadUtils(windowOverrides) {
  const ctx = {
    window: {
      location: { origin: 'https://example.com', pathname: '/browse/todos/', hash: '' },
      history: { replaceState: jest.fn() },
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
