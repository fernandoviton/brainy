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

describe('tracker storage', () => {
  test('listTrackerEntries reads one tracker since a date, oldest first', async () => {
    const chains = script(ok([{ id: 'a' }]));
    expect(await storage.listTrackerEntries('knee', '2026-11-01')).toEqual([{ id: 'a' }]);
    const c = chains[0];
    expect(c.table).toBe('brainy_tracker_entries');
    expect(c.eq).toHaveBeenCalledWith('tracker', 'knee');
    expect(c.gte).toHaveBeenCalledWith('entry_date', '2026-11-01');
    expect(c.order).toHaveBeenCalledWith('occurred_at', { ascending: true });
  });

  test('listTrackerSettings returns every tracker row', async () => {
    const chains = script(ok([{ tracker: 'knee', settings: { title: 'Knee PT' }, push_checked_at: null }]));
    expect(await storage.listTrackerSettings()).toEqual([{ tracker: 'knee', settings: { title: 'Knee PT' }, push_checked_at: null }]);
    expect(chains[0].table).toBe('brainy_tracker_settings');
  });

  test('setTrackerPushCheckedAt updates that tracker\'s row', async () => {
    const chains = script(ok(null));
    await storage.setTrackerPushCheckedAt('knee', '2026-11-11T17:30:00.000Z');
    expect(chains[0].update).toHaveBeenCalledWith({ push_checked_at: '2026-11-11T17:30:00.000Z' });
    expect(chains[0].eq).toHaveBeenCalledWith('tracker', 'knee');
  });

  test('push subscriptions: list, update, delete', async () => {
    const chains = script(ok([{ id: 's1' }]), ok(null), ok(null));
    expect(await storage.listTrackerPushSubscriptions()).toEqual([{ id: 's1' }]);
    await storage.updateTrackerPushSubscription('s1', { last_error: 'boom' });
    await storage.deleteTrackerPushSubscription('s1');
    expect(chains.map((c) => c.table)).toEqual(Array(3).fill('brainy_tracker_push_subscriptions'));
    expect(chains[1].update).toHaveBeenCalledWith({ last_error: 'boom' });
    expect(chains[2].eq).toHaveBeenCalledWith('id', 's1');
  });

  test('throws Supabase errors', async () => {
    script({ data: null, error: { message: 'relation "brainy_tracker_entries" does not exist' } });
    await expect(storage.listTrackerEntries('knee', '2026-11-01')).rejects.toBeTruthy();
  });
});
