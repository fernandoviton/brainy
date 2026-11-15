const store = require('../../../frontend/tracker/tracker-store.js');

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

describe('trkSupabaseStore', () => {
  test('listEntries reads one tracker\'s entries since a date, newest first', async () => {
    const db = mockDb({ data: [{ id: 'a' }], error: null });
    expect(await store.trkSupabaseStore(db, 'u1', 'knee').listEntries('2026-10-01')).toEqual([{ id: 'a' }]);
    const c = db.calls[0];
    expect(c.table).toBe('brainy_tracker_entries');
    expect(c.ops).toContainEqual(['eq', 'tracker', 'knee']);
    expect(c.ops).toContainEqual(['gte', 'entry_date', '2026-10-01']);
    expect(c.ops).toContainEqual(['order', 'occurred_at', { ascending: false }]);
  });

  test('addEntry stamps user and tracker and returns the saved row', async () => {
    const db = mockDb({ data: { id: 'new' }, error: null });
    const row = await store.trkSupabaseStore(db, 'u1', 'knee').addEntry({ kind: 'flare', pain: 4 });
    expect(row.id).toBe('new');
    expect(db.calls[0].ops[0]).toEqual(['insert', { kind: 'flare', pain: 4, user_id: 'u1', tracker: 'knee' }]);
  });

  test('throws Supabase errors', async () => {
    const db = mockDb({ data: null, error: { message: 'permission denied' } });
    await expect(store.trkSupabaseStore(db, 'u1', 'knee').listEntries('2026-10-01')).rejects.toThrow('permission denied');
  });

  test('getSettings reads this tracker\'s row, or null', async () => {
    const db = mockDb({ data: { settings: { title: 'Knee PT' } }, error: null });
    expect(await store.trkSupabaseStore(db, 'u1', 'knee').getSettings()).toEqual({ title: 'Knee PT' });
    expect(db.calls[0].ops).toContainEqual(['eq', 'tracker', 'knee']);
    db.result = { data: null, error: null };
    expect(await store.trkSupabaseStore(db, 'u1', 'knee').getSettings()).toBeNull();
  });

  test('saveSettings upserts one row per user and tracker', async () => {
    const db = mockDb();
    await store.trkSupabaseStore(db, 'u1', 'knee').saveSettings({ title: 'Knee PT' });
    expect(db.calls[0].table).toBe('brainy_tracker_settings');
    expect(db.calls[0].ops[0]).toEqual(['upsert', { user_id: 'u1', tracker: 'knee', settings: { title: 'Knee PT' } }, { onConflict: 'user_id,tracker' }]);
  });

  test('listTrackers returns id and title of every tracker', async () => {
    const db = mockDb({ data: [{ tracker: 'knee', settings: { title: 'Knee PT' } }], error: null });
    expect(await store.trkSupabaseStore(db, 'u1').listTrackers()).toEqual([{ id: 'knee', title: 'Knee PT' }]);
  });

  test('savePushSubscription stores endpoint and keys, keyed by endpoint', async () => {
    const db = mockDb();
    await store.trkSupabaseStore(db, 'u1', 'knee').savePushSubscription(
      { endpoint: 'https://push/x', keys: { p256dh: 'P', auth: 'A' } }, 'iPhone');
    expect(db.calls[0].table).toBe('brainy_tracker_push_subscriptions');
    expect(db.calls[0].ops[0]).toEqual(['upsert',
      { user_id: 'u1', endpoint: 'https://push/x', p256dh: 'P', auth: 'A', user_agent: 'iPhone' },
      { onConflict: 'endpoint' }]);
  });
});

describe('trkLocalStore (demo mode)', () => {
  test('keeps trackers apart and round-trips entries newest first', async () => {
    const ls = memoryStorage();
    const knee = store.trkLocalStore(ls, 'knee');
    const back = store.trkLocalStore(ls, 'back');
    await knee.addEntry({ kind: 'checkin', entry_date: '2026-11-01', occurred_at: '2026-11-01T10:00:00Z' });
    const b = await knee.addEntry({ kind: 'flare', entry_date: '2026-11-10', occurred_at: '2026-11-10T10:00:00Z' });
    await back.addEntry({ kind: 'flare', entry_date: '2026-11-10', occurred_at: '2026-11-10T11:00:00Z' });
    expect((await knee.listEntries('2026-11-05')).map((e) => e.kind)).toEqual(['flare']);
    expect(await back.listEntries('2026-10-01')).toHaveLength(1);
    await knee.deleteEntry(b.id);
    expect(await knee.listEntries('2026-10-01')).toHaveLength(1);
  });

  test('settings per tracker, and listTrackers', async () => {
    const ls = memoryStorage();
    expect(await store.trkLocalStore(ls, 'knee').getSettings()).toBeNull();
    await store.trkLocalStore(ls, 'knee').saveSettings({ title: 'Knee PT' });
    await store.trkLocalStore(ls, 'back').saveSettings({ title: 'Back' });
    expect(await store.trkLocalStore(ls, 'knee').getSettings()).toEqual({ title: 'Knee PT' });
    expect(await store.trkLocalStore(ls).listTrackers()).toEqual([{ id: 'knee', title: 'Knee PT' }, { id: 'back', title: 'Back' }]);
  });
});

describe('trkWithOutbox', () => {
  test('queues an entry that fails on the network and reports it as queued', async () => {
    const inner = { addEntry: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    const s = store.trkWithOutbox(inner, memoryStorage(), 'knee');
    expect((await s.addEntry({ kind: 'flare', pain: 5 })).queued).toBe(true);
    expect(s.pendingCount()).toBe(1);
  });

  test('outboxes are per tracker', async () => {
    const ls = memoryStorage();
    const inner = { addEntry: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    await store.trkWithOutbox(inner, ls, 'knee').addEntry({ kind: 'flare' });
    expect(store.trkWithOutbox(inner, ls, 'back').pendingCount()).toBe(0);
  });

  test('does not queue validation / permission errors', async () => {
    const inner = { addEntry: jest.fn().mockRejectedValue(new Error('new row violates row-level security')) };
    const s = store.trkWithOutbox(inner, memoryStorage(), 'knee');
    await expect(s.addEntry({ kind: 'flare' })).rejects.toThrow(/row-level/);
    expect(s.pendingCount()).toBe(0);
  });

  test('flush sends queued entries in order and keeps the ones that still fail', async () => {
    const inner = { addEntry: jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) };
    const s = store.trkWithOutbox(inner, memoryStorage(), 'knee');
    await s.addEntry({ kind: 'flare', pain: 1 });
    await s.addEntry({ kind: 'flare', pain: 2 });
    inner.addEntry.mockReset();
    inner.addEntry.mockResolvedValueOnce({ id: 'x' }).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await s.flush()).toBe(1);
    expect(inner.addEntry.mock.calls[0][0]).toEqual({ kind: 'flare', pain: 1 });
    expect(s.pendingCount()).toBe(1);
  });

  test('passes other calls through to the wrapped store', async () => {
    const inner = { addEntry: jest.fn(), listEntries: jest.fn().mockResolvedValue([1]) };
    expect(await store.trkWithOutbox(inner, memoryStorage(), 'knee').listEntries('2026-01-01')).toEqual([1]);
  });
});
