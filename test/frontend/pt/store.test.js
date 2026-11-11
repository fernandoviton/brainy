const store = require('../../../frontend/pt/pt-store.js');

// A Supabase query-builder stand-in that records the chain and resolves to `result`.
function mockDb(result) {
  const calls = [];
  const db = {
    calls,
    result: result || { data: [], error: null },
    from: jest.fn((table) => {
      const chain = { table, ops: [] };
      calls.push(chain);
      const builder = {};
      ['select', 'insert', 'upsert', 'delete', 'eq', 'gte', 'order', 'limit'].forEach((op) => {
        builder[op] = jest.fn((...args) => { chain.ops.push([op, ...args]); return builder; });
      });
      builder.single = jest.fn(() => { chain.ops.push(['single']); return Promise.resolve(db.result); });
      builder.maybeSingle = jest.fn(() => { chain.ops.push(['maybeSingle']); return Promise.resolve(db.result); });
      builder.then = (resolve, reject) => Promise.resolve(db.result).then(resolve, reject);
      return builder;
    }),
  };
  return db;
}

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    data,
  };
}

describe('ptSupabaseStore', () => {
  test('listEntries reads the user\'s entries since a date, newest first', async () => {
    const db = mockDb({ data: [{ id: 'a' }], error: null });
    const rows = await store.ptSupabaseStore(db, 'u1').listEntries('2026-10-01');
    expect(rows).toEqual([{ id: 'a' }]);
    const c = db.calls[0];
    expect(c.table).toBe('brainy_pt_entries');
    expect(c.ops).toContainEqual(['gte', 'entry_date', '2026-10-01']);
    expect(c.ops).toContainEqual(['order', 'occurred_at', { ascending: false }]);
  });

  test('addEntry inserts with user_id and returns the saved row', async () => {
    const db = mockDb({ data: { id: 'new', kind: 'flare' }, error: null });
    const row = await store.ptSupabaseStore(db, 'u1').addEntry({ kind: 'flare', pain: 4 });
    expect(row.id).toBe('new');
    expect(db.calls[0].ops[0]).toEqual(['insert', { kind: 'flare', pain: 4, user_id: 'u1' }]);
  });

  test('throws Supabase errors', async () => {
    const db = mockDb({ data: null, error: { message: 'permission denied' } });
    await expect(store.ptSupabaseStore(db, 'u1').listEntries('2026-10-01')).rejects.toThrow('permission denied');
  });

  test('getSettings returns the stored object or null', async () => {
    const db = mockDb({ data: { settings: { timezone: 'UTC' } }, error: null });
    expect(await store.ptSupabaseStore(db, 'u1').getSettings()).toEqual({ timezone: 'UTC' });
    db.result = { data: null, error: null };
    expect(await store.ptSupabaseStore(db, 'u1').getSettings()).toBeNull();
  });

  test('saveSettings upserts one row per user', async () => {
    const db = mockDb();
    await store.ptSupabaseStore(db, 'u1').saveSettings({ timezone: 'UTC' });
    expect(db.calls[0].table).toBe('brainy_pt_settings');
    expect(db.calls[0].ops[0]).toEqual(['upsert', { user_id: 'u1', settings: { timezone: 'UTC' } }, { onConflict: 'user_id' }]);
  });

  test('savePushSubscription stores endpoint and keys, keyed by endpoint', async () => {
    const db = mockDb();
    await store.ptSupabaseStore(db, 'u1').savePushSubscription(
      { endpoint: 'https://push/x', keys: { p256dh: 'P', auth: 'A' } }, 'iPhone');
    expect(db.calls[0].table).toBe('brainy_pt_push_subscriptions');
    expect(db.calls[0].ops[0]).toEqual(['upsert',
      { user_id: 'u1', endpoint: 'https://push/x', p256dh: 'P', auth: 'A', user_agent: 'iPhone' },
      { onConflict: 'endpoint' }]);
  });
});

describe('ptLocalStore (demo mode)', () => {
  test('round-trips entries, newest first, filtered by date', async () => {
    const s = store.ptLocalStore(memoryStorage());
    await s.addEntry({ kind: 'morning', entry_date: '2026-11-01', occurred_at: '2026-11-01T10:00:00Z' });
    const b = await s.addEntry({ kind: 'flare', entry_date: '2026-11-10', occurred_at: '2026-11-10T10:00:00Z' });
    expect(b.id).toBeTruthy();
    expect((await s.listEntries('2026-11-05')).map((e) => e.kind)).toEqual(['flare']);
    await s.deleteEntry(b.id);
    expect(await s.listEntries('2026-10-01')).toHaveLength(1);
  });

  test('round-trips settings', async () => {
    const s = store.ptLocalStore(memoryStorage());
    expect(await s.getSettings()).toBeNull();
    await s.saveSettings({ timezone: 'UTC' });
    expect(await s.getSettings()).toEqual({ timezone: 'UTC' });
  });
});

describe('ptWithOutbox', () => {
  test('queues an entry that fails on the network and reports it as queued', async () => {
    const ls = memoryStorage();
    const inner = { addEntry: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    const s = store.ptWithOutbox(inner, ls);
    const row = await s.addEntry({ kind: 'flare', pain: 5 });
    expect(row.queued).toBe(true);
    expect(s.pendingCount()).toBe(1);
  });

  test('does not queue validation / permission errors', async () => {
    const inner = { addEntry: jest.fn().mockRejectedValue(new Error('new row violates row-level security')) };
    const s = store.ptWithOutbox(inner, memoryStorage());
    await expect(s.addEntry({ kind: 'flare' })).rejects.toThrow(/row-level/);
    expect(s.pendingCount()).toBe(0);
  });

  test('flush sends queued entries in order and keeps the ones that still fail', async () => {
    const ls = memoryStorage();
    const inner = { addEntry: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    const s = store.ptWithOutbox(inner, ls);
    await s.addEntry({ kind: 'flare', pain: 1 });
    await s.addEntry({ kind: 'flare', pain: 2 });

    inner.addEntry.mockReset();
    inner.addEntry
      .mockResolvedValueOnce({ id: 'x' })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const sent = await s.flush();
    expect(sent).toBe(1);
    expect(inner.addEntry.mock.calls[0][0]).toEqual({ kind: 'flare', pain: 1 });
    expect(s.pendingCount()).toBe(1);
  });

  test('passes other calls through to the wrapped store', async () => {
    const inner = { addEntry: jest.fn(), listEntries: jest.fn().mockResolvedValue([1]) };
    const s = store.ptWithOutbox(inner, memoryStorage());
    expect(await s.listEntries('2026-01-01')).toEqual([1]);
  });
});
