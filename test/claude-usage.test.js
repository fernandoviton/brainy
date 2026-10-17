const fs = require('fs');
const os = require('os');
const path = require('path');
const { createUsageProbe, normalizeUsage, defaultRefreshAuth, USAGE_URL } = require('../backend/claude-usage');

const NOW = new Date('2026-10-20T12:00:00Z');

const RAW = {
  five_hour: { utilization: 7.0, resets_at: '2026-10-20T15:00:00+00:00' },
  seven_day: { utilization: 12.4, resets_at: '2026-10-22T10:00:00+00:00' },
  extra_usage: { is_enabled: false },
};

let dir;
let credsPath;

function writeCreds(expiresAt, token = 'tok-1') {
  fs.writeFileSync(credsPath, JSON.stringify({
    claudeAiOauth: { accessToken: token, refreshToken: 'secret', expiresAt: expiresAt.getTime() },
  }));
}

function okFetch(body = RAW) {
  return jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-usage-'));
  credsPath = path.join(dir, '.credentials.json');
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('normalizeUsage', () => {
  test('maps the 5-hour and weekly windows', () => {
    expect(normalizeUsage(RAW, NOW)).toEqual({
      fetched_at: NOW.toISOString(),
      session: { percent: 7, resets_at: '2026-10-20T15:00:00.000Z' },
      weekly: { percent: 12.4, resets_at: '2026-10-22T10:00:00.000Z' },
    });
  });

  test('rejects a response missing the weekly window (endpoint changed shape)', () => {
    expect(() => normalizeUsage({ five_hour: RAW.five_hour }, NOW)).toThrow(/unexpected usage response/);
  });
});

describe('defaultRefreshAuth', () => {
  test('runs claude outside any project so no project hooks fire', () => {
    const spawn = jest.fn(() => ({ status: 0 }));
    defaultRefreshAuth(spawn);
    const [bin, args, opts] = spawn.mock.calls[0];
    expect(bin).toBe('claude');
    expect(args).toEqual(expect.arrayContaining(['-p', '--model', 'haiku']));
    expect(opts.cwd).toBe(os.tmpdir());
  });
});

describe('createUsageProbe', () => {
  test('calls the usage endpoint with the OAuth bearer token', async () => {
    writeCreds(new Date(NOW.getTime() + 3600e3));
    const fetchImpl = okFetch();
    const probe = createUsageProbe({ credentialsPath: credsPath, fetchImpl, now: () => NOW, refreshAuth: jest.fn() });
    const u = await probe();
    expect(fetchImpl).toHaveBeenCalledWith(USAGE_URL, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
    }));
    expect(u.weekly.percent).toBe(12.4);
  });

  test('an expired token is refreshed via Claude Code (never by us) and re-read', async () => {
    writeCreds(new Date(NOW.getTime() - 60e3), 'old');
    const refreshAuth = jest.fn(() => writeCreds(new Date(NOW.getTime() + 3600e3), 'new'));
    const fetchImpl = okFetch();
    const probe = createUsageProbe({ credentialsPath: credsPath, fetchImpl, now: () => NOW, refreshAuth });
    await probe();
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer new');
  });

  test('still expired after the refresh attempt -> error, no request', async () => {
    writeCreds(new Date(NOW.getTime() - 60e3));
    const fetchImpl = okFetch();
    const probe = createUsageProbe({ credentialsPath: credsPath, fetchImpl, now: () => NOW, refreshAuth: jest.fn() });
    await expect(probe()).rejects.toThrow(/expired/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('missing credentials file -> clear error', async () => {
    const probe = createUsageProbe({ credentialsPath: credsPath, fetchImpl: okFetch(), now: () => NOW, refreshAuth: jest.fn() });
    await expect(probe()).rejects.toThrow(/credentials/);
  });

  test('non-200 -> error carrying the status', async () => {
    writeCreds(new Date(NOW.getTime() + 3600e3));
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const probe = createUsageProbe({ credentialsPath: credsPath, fetchImpl, now: () => NOW, refreshAuth: jest.fn() });
    await expect(probe()).rejects.toThrow(/429/);
  });
});
