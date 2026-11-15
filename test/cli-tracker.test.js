const mockStorage = {
  listTrackerEntries: jest.fn(),
  listTrackerSettings: jest.fn(),
  setTrackerPushCheckedAt: jest.fn(),
  listTrackerPushSubscriptions: jest.fn(),
  updateTrackerPushSubscription: jest.fn(),
  deleteTrackerPushSubscription: jest.fn(),
  recordRunEvent: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const mockReminders = {
  sendDueReminders: jest.fn(),
  webPushSender: jest.fn(() => 'SENDER'),
};
jest.mock('../backend/tracker-reminders', () => mockReminders);

const { main } = require('../backend/cli.js');

function runCLI(args) {
  const origArgv = process.argv;
  const origExit = process.exit;
  const origLog = console.log;
  const origError = console.error;
  const output = [];
  const errors = [];
  let exitCode = 0;
  process.argv = ['node', 'backend/cli.js', ...args];
  console.log = (...a) => output.push(a.join(' '));
  console.error = (...a) => errors.push(a.join(' '));
  let exited = false;
  process.exit = (code) => {
    if (!exited) { exitCode = code; exited = true; }
    throw new Error(`EXIT_${code}`);
  };
  return main()
    .catch(() => {})
    .then(() => {
      process.argv = origArgv;
      process.exit = origExit;
      console.log = origLog;
      console.error = origError;
      return { output: output.join('\n'), errors: errors.join('\n'), exitCode };
    });
}

const KNEE = {
  tracker: 'knee',
  push_checked_at: null,
  settings: {
    title: 'Knee PT',
    areas: [{ id: 'right', label: 'Right knee' }, { id: 'left', label: 'Left knee' }],
    triggers: [{ id: 'car', label: 'Car' }],
    activities: [{ id: 'lift', label: 'Lift day' }],
  },
};
const BACK = { tracker: 'back', push_checked_at: null, settings: { title: 'Back', areas: [{ id: 'low', label: 'Low back' }], triggers: [{ id: 'x', label: 'X' }] } };

const ENTRIES = [
  { kind: 'checkin', entry_date: '2026-11-10', occurred_at: '2026-11-10T14:00:00Z', scores: { right: 4, left: 2 } },
  { kind: 'flare', entry_date: '2026-11-10', occurred_at: '2026-11-10T20:00:00Z', pain: 6, area: 'right', trigger: 'car', note: 'long drive' },
  { kind: 'activity', entry_date: '2026-11-10', occurred_at: '2026-11-10T22:00:00Z', item_id: 'lift', item_label: 'Lift day', detail: 'squats' },
  { kind: 'exercise', entry_date: '2026-11-10', occurred_at: '2026-11-10T23:00:00Z', item_id: 'stretch', item_label: 'Knee stretch' },
];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BRAINY_RUN_ID;
});

describe('tracker list', () => {
  test('lists tracker ids and titles', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE, BACK]);
    const r = await runCLI(['tracker', 'list']);
    expect(r.output).toContain('knee  Knee PT');
    expect(r.output).toContain('back  Back');
  });
});

describe('tracker log', () => {
  test('uses the only tracker when there is one, and describes entries with labels', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE]);
    mockStorage.listTrackerEntries.mockResolvedValue(ENTRIES);
    const r = await runCLI(['tracker', 'log', '--days', '7']);
    expect(r.exitCode).toBe(0);
    expect(mockStorage.listTrackerEntries).toHaveBeenCalledWith('knee', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(r.output).toContain('checkin Right knee 4, Left knee 2');
    expect(r.output).toContain('flare 6 Right knee — Car — long drive');
    expect(r.output).toContain('Lift day — squats');
    expect(r.output).toContain('exercise Knee stretch');
  });

  test('needs --tracker when there are several', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE, BACK]);
    const r = await runCLI(['tracker', 'log']);
    expect(r.exitCode).toBe(1);
    expect(r.errors).toMatch(/--tracker.*knee.*back/);
    expect(mockStorage.listTrackerEntries).not.toHaveBeenCalled();
  });

  test('rejects an unknown --tracker', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE]);
    const r = await runCLI(['tracker', 'log', '--tracker', 'elbow']);
    expect(r.exitCode).toBe(1);
    expect(r.errors).toContain('elbow');
  });

  test('--format json returns the raw rows', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE, BACK]);
    mockStorage.listTrackerEntries.mockResolvedValue(ENTRIES);
    const r = await runCLI(['tracker', 'log', '--tracker', 'knee', '--format', 'json']);
    expect(JSON.parse(r.output)).toHaveLength(4);
  });

  test('rejects a non-numeric --days before reading anything', async () => {
    const r = await runCLI(['tracker', 'log', '--days', 'lots']);
    expect(r.exitCode).toBe(1);
    expect(mockStorage.listTrackerEntries).not.toHaveBeenCalled();
  });
});

describe('tracker summary', () => {
  test('per-day rows and the per-activity comparison', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE]);
    mockStorage.listTrackerEntries.mockResolvedValue(ENTRIES);
    const s = JSON.parse((await runCLI(['tracker', 'summary', '--days', '3', '--format', 'json'])).output);
    expect(s.days).toHaveLength(3);
    expect(s.activities[0]).toMatchObject({ id: 'lift', label: 'Lift day' });
  });

  test('text output names areas and activities', async () => {
    mockStorage.listTrackerSettings.mockResolvedValue([KNEE]);
    mockStorage.listTrackerEntries.mockResolvedValue([]);
    const r = await runCLI(['tracker', 'summary', '--days', '2']);
    expect(r.output).toContain('Right');
    expect(r.output).toContain('Lift day');
  });
});

describe('tracker remind', () => {
  test('sends due reminders through the web-push sender', async () => {
    mockReminders.sendDueReminders.mockResolvedValue({
      due: [{ tracker: 'knee', label: 'PT stretch', time: '12:30' }], trackers: [], errors: [], sent: 1, failed: 0, removed: 0,
    });
    const r = await runCLI(['tracker', 'remind']);
    expect(r.exitCode).toBe(0);
    expect(mockReminders.sendDueReminders).toHaveBeenCalledWith(expect.objectContaining({ storage: mockStorage, sendPush: 'SENDER' }));
    expect(r.output).toContain('knee 12:30: PT stretch');
  });

  test('a missing VAPID setup is an error', async () => {
    mockReminders.webPushSender.mockImplementationOnce(() => { throw new Error('VAPID_PRIVATE_KEY is not set'); });
    const r = await runCLI(['tracker', 'remind']);
    expect(r.exitCode).toBe(1);
    expect(r.errors).toContain('VAPID_PRIVATE_KEY');
  });

  test('a tracker with broken settings makes the run fail visibly', async () => {
    mockReminders.sendDueReminders.mockResolvedValue({ due: [], trackers: [], errors: [{ tracker: 'bad', error: 'add at least one area' }], sent: 0, failed: 0, removed: 0 });
    const r = await runCLI(['tracker', 'remind']);
    expect(r.exitCode).toBe(1);
    expect(r.errors).toContain('bad');
  });
});
