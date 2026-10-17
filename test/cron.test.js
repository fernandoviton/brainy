const { parseCron, nextFire, maxGapMs } = require('../backend/cron');

// All expectations are built with the local-time Date constructor, matching how
// the scheduler evaluates cron (in the host's local timezone, like crontab).
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('parseCron', () => {
  test('accepts the five standard fields', () => {
    expect(() => parseCron('0 3 * * *')).not.toThrow();
    expect(() => parseCron('*/15 9-17 * * 1-5')).not.toThrow();
    expect(() => parseCron('0 0 1,15 jan,jul *')).not.toThrow();
  });

  test('accepts the @ macros', () => {
    for (const m of ['@hourly', '@daily', '@midnight', '@weekly', '@monthly', '@yearly', '@annually']) {
      expect(() => parseCron(m)).not.toThrow();
    }
  });

  test.each([
    ['', 'expected 5 fields'],
    ['* * * *', 'expected 5 fields'],
    ['* * * * * *', 'expected 5 fields'],
    ['60 * * * *', 'out of range'],
    ['* 24 * * *', 'out of range'],
    ['* * 0 * *', 'out of range'],
    ['* * * 13 *', 'out of range'],
    ['* * * * 8', 'out of range'],
    ['*/0 * * * *', 'step'],
    ['5-1 * * * *', 'range'],
    ['abc * * * *', 'invalid'],
    ['@sometimes', 'unknown macro'],
  ])('rejects %p', (expr, msg) => {
    expect(() => parseCron(expr)).toThrow(msg);
  });
});

describe('nextFire', () => {
  test('daily at 03:00 — later the same day', () => {
    expect(nextFire('0 3 * * *', at(2026, 10, 17, 1, 30))).toEqual(at(2026, 10, 17, 3, 0));
  });

  test('is strictly after the reference time', () => {
    expect(nextFire('0 3 * * *', at(2026, 10, 17, 3, 0))).toEqual(at(2026, 10, 18, 3, 0));
  });

  test('ignores seconds on the reference time', () => {
    const ref = new Date(2026, 9, 17, 2, 59, 30);
    expect(nextFire('0 3 * * *', ref)).toEqual(at(2026, 10, 17, 3, 0));
  });

  test('every 15 minutes', () => {
    expect(nextFire('*/15 * * * *', at(2026, 10, 17, 10, 7))).toEqual(at(2026, 10, 17, 10, 15));
    expect(nextFire('*/15 * * * *', at(2026, 10, 17, 10, 45))).toEqual(at(2026, 10, 17, 11, 0));
  });

  test('weekdays only skips the weekend (2026-10-17 is a Saturday)', () => {
    expect(nextFire('0 9 * * 1-5', at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 19, 9, 0));
  });

  test('day-of-week 7 means Sunday, like 0', () => {
    expect(nextFire('0 9 * * 7', at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 18, 9, 0));
    expect(nextFire('0 9 * * sun', at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 18, 9, 0));
  });

  test('month names and lists', () => {
    expect(nextFire('0 0 1 jan,jul *', at(2026, 10, 17))).toEqual(at(2027, 1, 1));
  });

  test('day-of-month and day-of-week both restricted means either (cron OR rule)', () => {
    // The 1st of the month OR any Monday — Monday 2026-10-19 comes first.
    expect(nextFire('0 0 1 * 1', at(2026, 10, 17))).toEqual(at(2026, 10, 19));
  });

  test('crosses a month boundary and skips short months', () => {
    expect(nextFire('0 0 31 * *', at(2026, 11, 1))).toEqual(at(2026, 12, 31));
  });

  test('ranges with steps', () => {
    expect(nextFire('0 8-18/5 * * *', at(2026, 10, 17, 9, 0))).toEqual(at(2026, 10, 17, 13, 0));
  });

  test('@weekly is Sunday midnight', () => {
    expect(nextFire('@weekly', at(2026, 10, 17, 12))).toEqual(at(2026, 10, 18, 0, 0));
  });

  test('an impossible date (Feb 30) throws instead of looping forever', () => {
    expect(() => nextFire('0 0 30 2 *', at(2026, 1, 1))).toThrow('no fire time');
  });
});

describe('maxGapMs', () => {
  test('daily job has a 24h gap', () => {
    expect(maxGapMs('0 3 * * *', at(2026, 10, 1))).toBe(24 * 3600e3);
  });

  test('weekday job reports the weekend gap, not the weekday one', () => {
    expect(maxGapMs('0 9 * * 1-5', at(2026, 10, 1))).toBe(72 * 3600e3);
  });
});
