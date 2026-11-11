const { sendDueReminders, buildPayload } = require('../backend/pt-reminders');

const NY = 'America/New_York';
const settings = {
  timezone: NY,
  exercises: [{ id: 'x', name: 'X' }],
  reminders: [{ id: 'pt', label: 'PT stretch', time: '12:30', days: [0, 1, 2, 3, 4, 5, 6] }],
  sitting: { enabled: true, every_minutes: 60, start: '09:00', end: '13:00', days: [0, 1, 2, 3, 4, 5, 6] },
};
const at = (h, m) => Date.UTC(2026, 10, 11, h + 5, m); // NY wall clock -> UTC (EST)

function deps(overrides) {
  const storage = {
    getPtSettings: jest.fn().mockResolvedValue({ settings, push_checked_at: new Date(at(12, 20)).toISOString() }),
    setPtPushCheckedAt: jest.fn().mockResolvedValue(),
    listPtPushSubscriptions: jest.fn().mockResolvedValue([{ id: 's1', endpoint: 'https://push/1', p256dh: 'P', auth: 'A' }]),
    updatePtPushSubscription: jest.fn().mockResolvedValue(),
    deletePtPushSubscription: jest.fn().mockResolvedValue(),
  };
  return { storage, sendPush: jest.fn().mockResolvedValue({ statusCode: 201 }), appUrl: 'https://x.github.io/brainy/pt/', ...overrides };
}

describe('sendDueReminders', () => {
  test('sends what came due since the last check to every subscription, then advances the check', async () => {
    const d = deps();
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.due.map((r) => r.label)).toEqual(['PT stretch']);
    expect(d.sendPush).toHaveBeenCalledTimes(1);
    const [sub, payload] = d.sendPush.mock.calls[0];
    expect(sub).toEqual({ endpoint: 'https://push/1', keys: { p256dh: 'P', auth: 'A' } });
    expect(JSON.parse(payload).notification).toMatchObject({ title: 'Knee PT', body: 'PT stretch', navigate: 'https://x.github.io/brainy/pt/' });
    expect(d.storage.updatePtPushSubscription).toHaveBeenCalledWith('s1', expect.objectContaining({ last_error: null }));
    expect(d.storage.setPtPushCheckedAt).toHaveBeenCalledWith(new Date(at(12, 35)).toISOString());
  });

  test('caps a long gap (host was down) and sends only the latest reminder of each kind', async () => {
    const d = deps();
    d.storage.getPtSettings.mockResolvedValue({ settings, push_checked_at: new Date(at(6, 0)).toISOString() });
    const res = await sendDueReminders({ ...d, now: at(12, 45) });
    // Window is capped to 12:15-12:45: only the 12:30 PT reminder; no stale sitting breaks.
    expect(res.from).toBe(at(12, 15));
    expect(res.due.map((r) => r.id)).toEqual(['pt']);
  });

  test('collapses several due sitting breaks into the latest one', async () => {
    const d = deps();
    d.storage.getPtSettings.mockResolvedValue({ settings, push_checked_at: new Date(at(9, 55)).toISOString() });
    const res = await sendDueReminders({ ...d, now: at(11, 1), maxWindowMs: 2 * 3600000 });
    expect(res.due.map((r) => r.time)).toEqual(['11:00']);
  });

  test('first run with no check time looks back one tick', async () => {
    const d = deps();
    d.storage.getPtSettings.mockResolvedValue({ settings, push_checked_at: null });
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.from).toBe(at(12, 20));
  });

  test('removes subscriptions the push service says are gone (404/410)', async () => {
    const d = deps({ sendPush: jest.fn().mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 })) });
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(d.storage.deletePtPushSubscription).toHaveBeenCalledWith('s1');
    expect(res.removed).toBe(1);
  });

  test('records other send errors and still advances the check', async () => {
    const d = deps({ sendPush: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { statusCode: 500 })) });
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(d.storage.updatePtPushSubscription).toHaveBeenCalledWith('s1', { last_error: 'timeout' });
    expect(res.failed).toBe(1);
    expect(d.storage.setPtPushCheckedAt).toHaveBeenCalled();
  });

  test('nothing due: no sends, check still advances', async () => {
    const d = deps();
    const res = await sendDueReminders({ ...d, now: at(12, 25) });
    expect(res.due).toEqual([]);
    expect(d.sendPush).not.toHaveBeenCalled();
    expect(d.storage.listPtPushSubscriptions).not.toHaveBeenCalled();
    expect(d.storage.setPtPushCheckedAt).toHaveBeenCalled();
  });

  test('no settings saved yet: skips', async () => {
    const d = deps();
    d.storage.getPtSettings.mockResolvedValue(null);
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.skipped).toMatch(/settings/);
    expect(d.storage.setPtPushCheckedAt).not.toHaveBeenCalled();
  });
});

describe('buildPayload', () => {
  test('is a Declarative Web Push message', () => {
    const p = JSON.parse(buildPayload({ label: 'Stand up', kind: 'sitting' }, 'https://a/pt/'));
    expect(p).toEqual({ web_push: 8030, notification: { title: 'Knee PT', body: 'Stand up', navigate: 'https://a/pt/', tag: 'pt-sitting' } });
  });
});
