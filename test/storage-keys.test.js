const { storageSafeFilename, assertSafeStorageKey } = require('../backend/storage-keys');

describe('storageSafeFilename', () => {
  test('drops # (Supabase treats it as a URL fragment)', () => {
    expect(storageSafeFilename('Invoice #91244912.pdf')).toBe('Invoice 91244912.pdf');
  });

  test('replaces other unsafe characters with _', () => {
    expect(storageSafeFilename('a?b%c[d]{e}"f<g>.pdf')).toBe('a_b_c_d__e__f_g_.pdf');
  });

  test('replaces non-ASCII characters (Supabase rejects them in keys)', () => {
    expect(storageSafeFilename('café résumé.pdf')).toBe('caf_ r_sum_.pdf');
  });

  test('replaces path separators so a filename cannot add folders', () => {
    expect(storageSafeFilename('a/b\\c.pdf')).toBe('a_b_c.pdf');
  });

  test('leaves ordinary names alone', () => {
    const names = ['IMG_1234.jpg', 'report v2 (final).pdf', "Bob's notes - 2026.md", 'a+b=c, d&e;f@g$h!i*j.txt'];
    for (const n of names) expect(storageSafeFilename(n)).toBe(n);
  });
});

describe('assertSafeStorageKey', () => {
  test('accepts a normal key with folders', () => {
    expect(() => assertSafeStorageKey('u-1/knowledge/home/hvac/Invoice 1.pdf')).not.toThrow();
  });

  test.each(['u/x/Invoice #1.pdf', 'u/x/a?b.pdf', 'u/x/café.pdf', 'u/x/50%.pdf'])('rejects %s', (key) => {
    expect(() => assertSafeStorageKey(key)).toThrow(/Unsafe storage key/);
  });
});
