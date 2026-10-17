const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSince, buildDigest } = require('../backend/agent-digest');

const NOW = new Date('2026-10-17T18:00:00Z');
let dir;
let seenFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainy-digest-'));
  seenFile = path.join(dir, 'agent-digest-seen');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('readSince', () => {
  test('first session on this machine looks back 24h', () => {
    expect(readSince(seenFile, NOW)).toBe('2026-10-16T18:00:00.000Z');
  });

  test('otherwise the last time a digest was shown', () => {
    fs.writeFileSync(seenFile, '2026-10-17T09:00:00.000Z\n');
    expect(readSince(seenFile, NOW)).toBe('2026-10-17T09:00:00.000Z');
  });

  test('a corrupt marker falls back to 24h', () => {
    fs.writeFileSync(seenFile, 'garbage');
    expect(readSince(seenFile, NOW)).toBe('2026-10-16T18:00:00.000Z');
  });
});

describe('buildDigest', () => {
  const report = {
    id: 'r1', job_name: 'email-triage', status: 'succeeded', report: 'x',
    events: [{ action: 'create', target_type: 'todo', target: 'reply-to-jane' }],
  };

  test('summarises reports and advances the marker', async () => {
    fs.writeFileSync(seenFile, '2026-10-17T09:00:00.000Z');
    const listReports = jest.fn().mockResolvedValue([report]);
    const msg = await buildDigest({ listReports, seenFile, now: NOW, env: {} });
    expect(listReports).toHaveBeenCalledWith({ since: '2026-10-17T09:00:00.000Z', limit: 50 });
    expect(msg).toMatch(/email-triage: 1 run, created 1 TODO \(reply-to-jane\)/);
    expect(fs.readFileSync(seenFile, 'utf8').trim()).toBe(NOW.toISOString());
  });

  test('nothing new -> null, marker still advances', async () => {
    const msg = await buildDigest({ listReports: async () => [], seenFile, now: NOW, env: {} });
    expect(msg).toBeNull();
    expect(fs.readFileSync(seenFile, 'utf8').trim()).toBe(NOW.toISOString());
  });

  test('inside a scheduled job run it does nothing (the agent must not consume your digest)', async () => {
    const listReports = jest.fn();
    const msg = await buildDigest({ listReports, seenFile, now: NOW, env: { BRAINY_RUN_ID: 'r' } });
    expect(msg).toBeNull();
    expect(listReports).not.toHaveBeenCalled();
    expect(fs.existsSync(seenFile)).toBe(false);
  });

  test('a failed lookup leaves the marker alone so nothing is skipped', async () => {
    fs.writeFileSync(seenFile, '2026-10-17T09:00:00.000Z');
    await expect(buildDigest({ listReports: async () => { throw new Error('offline'); }, seenFile, now: NOW, env: {} }))
      .rejects.toThrow('offline');
    expect(fs.readFileSync(seenFile, 'utf8').trim()).toBe('2026-10-17T09:00:00.000Z');
  });
});
