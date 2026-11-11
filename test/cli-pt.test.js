const mockStorage = {
  listPtEntries: jest.fn(),
  getPtSettings: jest.fn(),
  setPtPushCheckedAt: jest.fn(),
  listPtPushSubscriptions: jest.fn(),
  updatePtPushSubscription: jest.fn(),
  deletePtPushSubscription: jest.fn(),
  recordRunEvent: jest.fn(),
};

jest.mock('../backend/storage', () => ({
  getStorage: () => mockStorage,
}));

const mockReminders = {
  sendDueReminders: jest.fn(),
  webPushSender: jest.fn(() => 'SENDER'),
};
jest.mock('../backend/pt-reminders', () => mockReminders);

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

const ENTRIES = [
  { kind: 'morning', entry_date: '2026-11-10', occurred_at: '2026-11-10T14:00:00Z', pain_right: 4, pain_left: 2 },
  { kind: 'flare', entry_date: '2026-11-10', occurred_at: '2026-11-10T20:00:00Z', pain: 6, side: 'right', trigger: 'car', note: 'long drive' },
  { kind: 'lift', entry_date: '2026-11-10', occurred_at: '2026-11-10T22:00:00Z', lift_notes: 'squats' },
];

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BRAINY_RUN_ID;
});

describe('pt log', () => {
  test('lists entries for the last N days as text', async () => {
    mockStorage.listPtEntries.mockResolvedValue(ENTRIES);
    const r = await runCLI(['pt', 'log', '--days', '7']);
    expect(r.exitCode).toBe(0);
    expect(mockStorage.listPtEntries).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(r.output).toContain('2026-11-10');
    expect(r.output).toContain('morning R4 L2');
    expect(r.output).toContain('flare 6 right car — long drive');
    expect(r.output).toContain('lift squats');
  });

  test('--format json returns the raw rows', async () => {
    mockStorage.listPtEntries.mockResolvedValue(ENTRIES);
    const r = await runCLI(['pt', 'log', '--format', 'json']);
    expect(JSON.parse(r.output)).toHaveLength(3);
  });

  test('rejects a non-numeric --days', async () => {
    const r = await runCLI(['pt', 'log', '--days', 'lots']);
    expect(r.exitCode).toBe(1);
    expect(mockStorage.listPtEntries).not.toHaveBeenCalled();
  });
});

describe('pt summary', () => {
  test('prints daily rows and the lift comparison', async () => {
    mockStorage.listPtEntries.mockResolvedValue(ENTRIES);
    const r = await runCLI(['pt', 'summary', '--days', '3', '--format', 'json']);
    const s = JSON.parse(r.output);
    expect(s.days).toHaveLength(3);
    expect(s.lift).toHaveProperty('flaresPerLiftDay');
  });
});

describe('pt remind', () => {
  test('sends due reminders through the web-push sender', async () => {
    mockReminders.sendDueReminders.mockResolvedValue({ from: 0, to: 1, due: [{ label: 'PT stretch', time: '12:30' }], sent: 1, failed: 0, removed: 0 });
    const r = await runCLI(['pt', 'remind']);
    expect(r.exitCode).toBe(0);
    expect(mockReminders.sendDueReminders).toHaveBeenCalledWith(expect.objectContaining({ storage: mockStorage, sendPush: 'SENDER' }));
    expect(r.output).toContain('PT stretch');
  });

  test('a missing VAPID setup is an error', async () => {
    mockReminders.webPushSender.mockImplementationOnce(() => { throw new Error('VAPID_PRIVATE_KEY is not set'); });
    const r = await runCLI(['pt', 'remind']);
    expect(r.exitCode).toBe(1);
    expect(r.errors).toContain('VAPID_PRIVATE_KEY');
  });
});
