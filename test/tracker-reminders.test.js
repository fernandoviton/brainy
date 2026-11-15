const { sendDueReminders, buildPayload } = require('../backend/tracker-reminders');

const NY = 'America/New_York';
function settings(title, reminderTime, breaks) {
  return {
    title,
    timezone: NY,
    areas: [{ id: 'a', label: 'A' }],
    triggers: [{ id: 't', label: 'T' }],
    reminders: [{ id: 'daily', label: title + ' reminder', time: reminderTime, days: [0, 1, 2, 3, 4, 5, 6] }],
    breaks: breaks || { enabled: false, every_minutes: 60, start: '09:00', end: '13:00', days: [] },
  };
}
const at = (h, m) => Date.UTC(2026, 10, 11, h + 5, m); // NY wall clock -> UTC (EST)
const iso = (ms) => new Date(ms).toISOString();

function deps(rows, overrides) {
  const storage = {
    listTrackerSettings: jest.fn().mockResolvedValue(rows),
    setTrackerPushCheckedAt: jest.fn().mockResolvedValue(),
    listTrackerPushSubscriptions: jest.fn().mockResolvedValue([{ id: 's1', endpoint: 'https://push/1', p256dh: 'P', auth: 'A' }]),
    updateTrackerPushSubscription: jest.fn().mockResolvedValue(),
    deleteTrackerPushSubscription: jest.fn().mockResolvedValue(),
  };
  return { storage, sendPush: jest.fn().mockResolvedValue({ statusCode: 201 }), appUrl: 'https://x.github.io/brainy/tracker/', ...overrides };
}

const knee = (checked) => ({ tracker: 'knee', settings: settings('Knee PT', '12:30'), push_checked_at: checked });

describe('sendDueReminders', () => {
  test('sends what came due since the last check, linking to the tracker, then advances the check', async () => {
    const d = deps([knee(iso(at(12, 20)))]);
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.due.map((r) => `${r.tracker}:${r.label}`)).toEqual(['knee:Knee PT reminder']);
    const [sub, payload] = d.sendPush.mock.calls[0];
    expect(sub).toEqual({ endpoint: 'https://push/1', keys: { p256dh: 'P', auth: 'A' } });
    expect(JSON.parse(payload).notification).toMatchObject({
      title: 'Knee PT', body: 'Knee PT reminder', navigate: 'https://x.github.io/brainy/tracker/?t=knee',
    });
    expect(d.storage.updateTrackerPushSubscription).toHaveBeenCalledWith('s1', expect.objectContaining({ last_error: null }));
    expect(d.storage.setTrackerPushCheckedAt).toHaveBeenCalledWith('knee', iso(at(12, 35)));
  });

  test('handles every tracker, each with its own schedule and check time', async () => {
    const back = { tracker: 'back', settings: settings('Back', '12:25'), push_checked_at: iso(at(12, 20)) };
    const d = deps([knee(iso(at(12, 20))), back]);
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.due.map((r) => r.tracker).sort()).toEqual(['back', 'knee']);
    expect(d.sendPush).toHaveBeenCalledTimes(2);
    expect(d.storage.setTrackerPushCheckedAt).toHaveBeenCalledTimes(2);
    expect(d.storage.listTrackerPushSubscriptions).toHaveBeenCalledTimes(1);
  });

  test('caps a long gap (host was down)', async () => {
    const d = deps([knee(iso(at(6, 0)))]);
    const res = await sendDueReminders({ ...d, now: at(12, 45) });
    expect(res.trackers[0].from).toBe(at(12, 15));
    expect(res.due.map((r) => r.id)).toEqual(['daily']);
  });

  test('collapses several due breaks into the latest one', async () => {
    const brk = { enabled: true, label: 'Move', every_minutes: 60, start: '09:00', end: '13:00', days: [0, 1, 2, 3, 4, 5, 6] };
    const d = deps([{ tracker: 'knee', settings: settings('Knee PT', '20:00', brk), push_checked_at: iso(at(9, 55)) }]);
    const res = await sendDueReminders({ ...d, now: at(11, 1), maxWindowMs: 2 * 3600000 });
    expect(res.due.map((r) => r.time)).toEqual(['11:00']);
  });

  test('first run with no check time looks back one tick', async () => {
    const d = deps([knee(null)]);
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.trackers[0].from).toBe(at(12, 20));
  });

  test('removes subscriptions the push service says are gone (404/410)', async () => {
    const d = deps([knee(iso(at(12, 20)))], { sendPush: jest.fn().mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 })) });
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(d.storage.deleteTrackerPushSubscription).toHaveBeenCalledWith('s1');
    expect(res.removed).toBe(1);
  });

  test('records other send errors and still advances the check', async () => {
    const d = deps([knee(iso(at(12, 20)))], { sendPush: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { statusCode: 500 })) });
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(d.storage.updateTrackerPushSubscription).toHaveBeenCalledWith('s1', { last_error: 'timeout' });
    expect(res.failed).toBe(1);
    expect(d.storage.setTrackerPushCheckedAt).toHaveBeenCalled();
  });

  test('nothing due: no sends, no subscription lookup, checks still advance', async () => {
    const d = deps([knee(iso(at(12, 20)))]);
    const res = await sendDueReminders({ ...d, now: at(12, 25) });
    expect(res.due).toEqual([]);
    expect(d.sendPush).not.toHaveBeenCalled();
    expect(d.storage.listTrackerPushSubscriptions).not.toHaveBeenCalled();
    expect(d.storage.setTrackerPushCheckedAt).toHaveBeenCalled();
  });

  test('a tracker with broken settings is reported and skipped, not fatal', async () => {
    const bad = { tracker: 'bad', settings: { areas: [] }, push_checked_at: null };
    const d = deps([bad, knee(iso(at(12, 20)))]);
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.errors).toEqual([expect.objectContaining({ tracker: 'bad' })]);
    expect(res.sent).toBe(1);
  });

  test('no trackers: nothing to do', async () => {
    const d = deps([]);
    const res = await sendDueReminders({ ...d, now: at(12, 35) });
    expect(res.due).toEqual([]);
    expect(d.storage.setTrackerPushCheckedAt).not.toHaveBeenCalled();
  });
});

describe('buildPayload', () => {
  test('is a Declarative Web Push message', () => {
    const p = JSON.parse(buildPayload({ label: 'Stand up', kind: 'break', tracker: 'knee', title: 'Knee PT' }, 'https://a/tracker/'));
    expect(p).toEqual({
      web_push: 8030,
      notification: { title: 'Knee PT', body: 'Stand up', navigate: 'https://a/tracker/?t=knee', tag: 'knee-break' },
    });
  });
});
