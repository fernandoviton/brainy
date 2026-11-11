const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

// Each supabase.from() call gets its own chain; `results` are handed out in call order.
function script(...results) {
  const chains = [];
  mockSupabase.supabase.from.mockImplementation((table) => {
    const result = results[chains.length] || { data: [], error: null };
    const chain = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'gte', 'order', 'limit']) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    chain.maybeSingle = jest.fn(() => Promise.resolve(result));
    chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
    chain.table = table;
    chains.push(chain);
    return chain;
  });
  return chains;
}

const ok = (data) => ({ data, error: null });

afterEach(() => mockSupabase.resetMock());

describe('PT storage', () => {
  test('listPtEntries reads entries since a date, oldest first', async () => {
    const chains = script(ok([{ id: 'a' }]));
    expect(await storage.listPtEntries('2026-11-01')).toEqual([{ id: 'a' }]);
    const c = chains[0];
    expect(c.table).toBe('brainy_pt_entries');
    expect(c.gte).toHaveBeenCalledWith('entry_date', '2026-11-01');
    expect(c.order).toHaveBeenCalledWith('occurred_at', { ascending: true });
  });

  test('getPtSettings returns the row or null', async () => {
    script(ok({ settings: { timezone: 'UTC' }, push_checked_at: null }));
    expect(await storage.getPtSettings()).toEqual({ settings: { timezone: 'UTC' }, push_checked_at: null });
    script(ok(null));
    expect(await storage.getPtSettings()).toBeNull();
  });

  test('setPtPushCheckedAt updates the settings row', async () => {
    const chains = script(ok(null));
    await storage.setPtPushCheckedAt('2026-11-11T17:30:00.000Z');
    const c = chains[0];
    expect(c.table).toBe('brainy_pt_settings');
    expect(c.update).toHaveBeenCalledWith({ push_checked_at: '2026-11-11T17:30:00.000Z' });
  });

  test('push subscriptions: list, update, delete', async () => {
    const chains = script(ok([{ id: 's1' }]), ok(null), ok(null));
    expect(await storage.listPtPushSubscriptions()).toEqual([{ id: 's1' }]);
    await storage.updatePtPushSubscription('s1', { last_error: 'boom' });
    await storage.deletePtPushSubscription('s1');
    expect(chains.map((c) => c.table)).toEqual(Array(3).fill('brainy_pt_push_subscriptions'));
    expect(chains[1].update).toHaveBeenCalledWith({ last_error: 'boom' });
    expect(chains[2].delete).toHaveBeenCalled();
    expect(chains[2].eq).toHaveBeenCalledWith('id', 's1');
  });

  test('throws Supabase errors', async () => {
    script({ data: null, error: { message: 'relation "brainy_pt_entries" does not exist' } });
    await expect(storage.listPtEntries('2026-11-01')).rejects.toBeTruthy();
  });
});
