const core = require('../../../frontend/tracker/tracker-core.js');

const NY = 'America/New_York';

// A small non-knee tracker, to keep the tests honest about being generic.
function shoulder(overrides) {
  return core.trkNormalizeSettings({
    title: 'Shoulder rehab',
    timezone: NY,
    areas: [{ label: 'Right shoulder' }, { label: 'Neck' }],
    triggers: [{ label: 'Desk work' }, { label: 'Overhead lifting' }],
    activities: [{ label: 'Gym day', prompt: 'What did you train?' }],
    exercises: [{ name: 'Band pull-aparts' }],
    reminders: [{ id: 'rehab', label: 'Rehab', time: '12:30', days: [0, 1, 2, 3, 4, 5, 6] }],
    breaks: { enabled: false, label: 'Roll your shoulders', every_minutes: 45, start: '09:00', end: '17:00', days: [] },
    ...overrides,
  });
}

describe('time helpers', () => {
  test('trkLocalDate formats the calendar date in a zone', () => {
    expect(core.trkLocalDate(Date.UTC(2026, 10, 11, 3, 0), NY)).toBe('2026-11-10');
    expect(core.trkLocalDate(Date.UTC(2026, 10, 11, 3, 0), 'UTC')).toBe('2026-11-11');
  });

  test('trkZonedTimeToMs handles standard and daylight time', () => {
    expect(core.trkZonedTimeToMs('2026-11-11', '08:30', NY)).toBe(Date.UTC(2026, 10, 11, 13, 30));
    expect(core.trkZonedTimeToMs('2026-07-01', '08:30', NY)).toBe(Date.UTC(2026, 6, 1, 12, 30));
  });
});

describe('presets', () => {
  test('knee preset has both knees, the PT stretch and a lift-day activity', () => {
    const s = core.trkPresetSettings('knee');
    expect(s.title).toBe('Knee PT');
    expect(s.areas.map((a) => a.label)).toEqual(['Right knee', 'Left knee']);
    expect(s.triggers.map((t) => t.id)).toEqual(expect.arrayContaining(['sat-a-long-time', 'car', 'stairs-down']));
    expect(s.activities[0]).toMatchObject({ id: 'lift', label: 'Lift day' });
    expect(s.exercises.find((e) => /knee extension/i.test(e.name)).optional).toBe(false);
    expect(s.exercises.some((e) => e.optional)).toBe(true);
    expect(s.breaks.enabled).toBe(true);
  });

  test('blank preset is a usable generic tracker', () => {
    const s = core.trkPresetSettings('blank');
    expect(s.areas.length).toBeGreaterThan(0);
    expect(s.triggers.length).toBeGreaterThan(0);
    expect(() => core.trkNormalizeSettings(s)).not.toThrow();
  });

  test('lists presets for the start screen', () => {
    expect(core.TRK_PRESETS.map((p) => p.id)).toEqual(['knee', 'blank']);
  });
});

describe('trkNormalizeSettings', () => {
  test('slugs ids from labels and keeps them unique', () => {
    const s = shoulder({ triggers: [{ label: 'Desk work' }, { label: 'Desk work' }] });
    expect(s.areas.map((a) => a.id)).toEqual(['right-shoulder', 'neck']);
    expect(s.triggers.map((t) => t.id)).toEqual(['desk-work', 'desk-work-2']);
  });

  test('keeps existing ids when labels change, so old entries stay linked', () => {
    const s = shoulder({ areas: [{ id: 'right-shoulder', label: 'R shoulder' }] });
    expect(s.areas[0]).toEqual({ id: 'right-shoulder', label: 'R shoulder' });
  });

  test('fills in title, check-in label and break label', () => {
    const s = core.trkNormalizeSettings({ areas: [{ label: 'Back' }], triggers: [{ label: 'Other' }] });
    expect(s.title).toBe('Tracker');
    expect(s.checkin_label).toBe('Morning check-in');
    expect(s.breaks.label).toBeTruthy();
    expect(s.activities).toEqual([]);
  });

  test.each([
    [{ areas: [] }, /area/],
    [{ areas: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }] }, /at most 4/],
    [{ triggers: [] }, /trigger/],
    [{ exercises: [{ name: '  ' }] }, /name/],
    [{ reminders: [{ label: 'x', time: '25:00' }] }, /time/],
    [{ breaks: { enabled: true, every_minutes: 5, start: '09:00', end: '17:00', days: [1] } }, /every_minutes/],
    [{ breaks: { enabled: true, every_minutes: 30, start: '17:00', end: '09:00', days: [1] } }, /after start/],
  ])('rejects %j', (override, err) => {
    expect(() => shoulder(override)).toThrow(err);
  });
});

describe('trkBuildEntry', () => {
  const s = shoulder();
  const now = Date.UTC(2026, 10, 11, 14, 0);

  test('check-in records a score per area', () => {
    const e = core.trkBuildEntry('checkin', { scores: { 'right-shoulder': 4, neck: 2 } }, now, s, NY);
    expect(e).toEqual({
      kind: 'checkin', occurred_at: new Date(now).toISOString(), entry_date: '2026-11-11',
      scores: { 'right-shoulder': 4, neck: 2 },
    });
  });

  test('check-in needs every area scored', () => {
    expect(() => core.trkBuildEntry('checkin', { scores: { neck: 2 } }, now, s)).toThrow(/Right shoulder/);
  });

  test('check-in rejects unknown areas and bad scores', () => {
    expect(() => core.trkBuildEntry('checkin', { scores: { 'right-shoulder': 4, neck: 2, knee: 1 } }, now, s)).toThrow(/knee/);
    expect(() => core.trkBuildEntry('checkin', { scores: { 'right-shoulder': 11, neck: 2 } }, now, s)).toThrow(/0 to 10/);
  });

  test('flare records pain, area, trigger and a trimmed note', () => {
    const e = core.trkBuildEntry('flare', { pain: 6, area: 'neck', trigger: 'desk-work', note: ' long call ' }, now, s);
    expect(e).toMatchObject({ kind: 'flare', pain: 6, area: 'neck', trigger: 'desk-work', note: 'long call' });
  });

  test('flare area may be "all" when there are several areas', () => {
    expect(core.trkBuildEntry('flare', { pain: 3, area: 'all', trigger: 'desk-work' }, now, s).area).toBe('all');
  });

  test('flare with a single area defaults to it', () => {
    const one = shoulder({ areas: [{ label: 'Back' }] });
    expect(core.trkBuildEntry('flare', { pain: 3, trigger: 'desk-work' }, now, one).area).toBe('back');
  });

  test.each([
    [{ pain: 5, area: 'neck' }, /trigger/],
    [{ pain: 5, area: 'neck', trigger: 'gardening' }, /trigger/],
    [{ pain: 5, area: 'elbow', trigger: 'desk-work' }, /area/],
    [{ area: 'neck', trigger: 'desk-work' }, /pain/],
  ])('rejects flare %j', (fields, err) => {
    expect(() => core.trkBuildEntry('flare', fields, now, s)).toThrow(err);
  });

  test('activity keeps its label and optional detail', () => {
    const e = core.trkBuildEntry('activity', { item_id: 'gym-day', detail: 'push day' }, now, s);
    expect(e).toMatchObject({ kind: 'activity', item_id: 'gym-day', item_label: 'Gym day', detail: 'push day' });
  });

  test('exercise keeps the exercise name as of logging', () => {
    const e = core.trkBuildEntry('exercise', { item_id: 'band-pull-aparts' }, now, s);
    expect(e).toMatchObject({ kind: 'exercise', item_id: 'band-pull-aparts', item_label: 'Band pull-aparts' });
  });

  test('rejects unknown items and kinds', () => {
    expect(() => core.trkBuildEntry('exercise', { item_id: 'nope' }, now, s)).toThrow(/exercise/);
    expect(() => core.trkBuildEntry('activity', { item_id: 'nope' }, now, s)).toThrow(/activity/);
    expect(() => core.trkBuildEntry('nap', {}, now, s)).toThrow(/kind/);
  });
});

describe('reminder schedule', () => {
  const s = shoulder({
    reminders: [
      { id: 'daily', label: 'Rehab', time: '12:30', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'wk', label: 'Weekend only', time: '10:00', days: [0, 6] },
      { id: 'off', label: 'Disabled', time: '11:00', days: [3], enabled: false },
    ],
    breaks: { enabled: true, label: 'Roll your shoulders', every_minutes: 45, start: '09:00', end: '11:00', days: [1, 2, 3, 4, 5] },
  });

  test('trkReminderTimes lists reminders and breaks for a weekday in order', () => {
    // 2026-11-11 is a Wednesday.
    expect(core.trkReminderTimes(s, '2026-11-11').map((t) => `${t.time} ${t.kind} ${t.label}`)).toEqual([
      '09:45 break Roll your shoulders',
      '10:30 break Roll your shoulders',
      '12:30 reminder Rehab',
    ]);
  });

  test('weekend: no breaks, weekend reminder included', () => {
    expect(core.trkReminderTimes(s, '2026-11-14').map((t) => t.label)).toEqual(['Weekend only', 'Rehab']);
  });

  test('trkRemindersDue uses a half-open (from, to] window', () => {
    const fire = Date.UTC(2026, 10, 11, 17, 30);
    expect(core.trkRemindersDue(s, fire - 900000, fire).map((r) => r.id)).toEqual(['daily']);
    expect(core.trkRemindersDue(s, fire, fire + 900000)).toHaveLength(0);
  });

  test('trkRemindersDue works across local midnight', () => {
    const m = shoulder({ reminders: [{ id: 'm', label: 'Midnight', time: '00:00', days: [4] }] });
    const midnight = core.trkZonedTimeToMs('2026-11-12', '00:00', NY);
    expect(core.trkRemindersDue(m, midnight - 600000, midnight + 600000)).toHaveLength(1);
  });

  test('trkNextReminder looks ahead across days, or returns null', () => {
    const weekly = shoulder({ reminders: [{ id: 'w', label: 'W', time: '08:00', days: [1] }] });
    expect(core.trkNextReminder(weekly, Date.UTC(2026, 10, 11, 17, 0)).at)
      .toBe(core.trkZonedTimeToMs('2026-11-16', '08:00', NY));
    expect(core.trkNextReminder(shoulder({ reminders: [] }), Date.now())).toBeNull();
  });
});

describe('trkSummarize', () => {
  const s = shoulder();
  const entries = [
    { kind: 'checkin', entry_date: '2026-11-09', scores: { 'right-shoulder': 4, neck: 2 } },
    { kind: 'activity', entry_date: '2026-11-09', item_id: 'gym-day', detail: 'push' },
    { kind: 'flare', entry_date: '2026-11-09', pain: 5, area: 'neck', trigger: 'overhead-lifting' },
    { kind: 'flare', entry_date: '2026-11-09', pain: 7, area: 'neck', trigger: 'desk-work' },
    { kind: 'checkin', entry_date: '2026-11-10', scores: { 'right-shoulder': 6, neck: 3 } },
    { kind: 'flare', entry_date: '2026-11-10', pain: 4, area: 'all', trigger: 'desk-work' },
    { kind: 'exercise', entry_date: '2026-11-10', item_id: 'band-pull-aparts' },
    { kind: 'checkin', entry_date: '2026-11-11', scores: { 'right-shoulder': 3, neck: 3 } },
  ];

  test('one row per day, oldest first, with per-area scores and the worst', () => {
    const r = core.trkSummarize(entries, s, '2026-11-11', 4);
    expect(r.days.map((d) => d.date)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(r.days[0]).toMatchObject({ scores: { 'right-shoulder': null, neck: null }, worst: null, flares: 0 });
    expect(r.days[1]).toMatchObject({ scores: { 'right-shoulder': 4, neck: 2 }, worst: 4, flares: 2, maxFlare: 7 });
    expect(r.days[1].activities).toEqual({ 'gym-day': 'push' });
    expect(r.days[2]).toMatchObject({ exercises: 1, activities: {} });
  });

  test('counts triggers with their labels, most frequent first', () => {
    const r = core.trkSummarize(entries, s, '2026-11-11', 4);
    expect(r.triggers[0]).toEqual({ id: 'desk-work', label: 'Desk work', count: 2 });
    expect(r.triggers[1]).toMatchObject({ id: 'overhead-lifting', count: 1 });
  });

  test('labels a trigger that was since removed from settings by its id', () => {
    const r = core.trkSummarize([{ kind: 'flare', entry_date: '2026-11-11', pain: 2, trigger: 'old-one' }], s, '2026-11-11', 1);
    expect(r.triggers[0]).toEqual({ id: 'old-one', label: 'old-one', count: 1 });
  });

  test('compares each activity\'s days with other days', () => {
    const r = core.trkSummarize(entries, s, '2026-11-11', 4);
    expect(r.activities).toHaveLength(1);
    const gym = r.activities[0];
    expect(gym).toMatchObject({ id: 'gym-day', label: 'Gym day', days: 1, otherDays: 3, flaresPerDay: 2 });
    expect(gym.flaresPerOtherDay).toBeCloseTo(1 / 3);
    expect(gym.nextWorstAfter).toBe(6);
    expect(gym.nextWorstAfterOther).toBe(3.5);
  });

  test('the latest check-in of a day wins', () => {
    const r = core.trkSummarize([
      { kind: 'checkin', entry_date: '2026-11-11', occurred_at: '2026-11-11T12:00:00Z', scores: { 'right-shoulder': 2, neck: 2 } },
      { kind: 'checkin', entry_date: '2026-11-11', occurred_at: '2026-11-11T13:00:00Z', scores: { 'right-shoulder': 5, neck: 1 } },
    ], s, '2026-11-11', 1);
    expect(r.days[0].scores).toEqual({ 'right-shoulder': 5, neck: 1 });
  });
});

describe('trkBuildIcs', () => {
  const s = shoulder({
    reminders: [{ id: 'rehab', label: 'Rehab, then stretch', time: '12:30', days: [1, 3, 5] }],
    breaks: { enabled: true, label: 'Roll your shoulders', every_minutes: 60, start: '09:00', end: '11:00', days: [1, 2, 3, 4, 5] },
  });
  const ics = core.trkBuildIcs(s, '2026-11-11');

  test('is a CRLF calendar named after the tracker', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Shoulder rehab');
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  test('one weekly event with an alarm per reminder time', () => {
    expect(ics.split('BEGIN:VEVENT').length - 1).toBe(3);
    expect(ics.split('BEGIN:VALARM').length - 1).toBe(3);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261111T123000');
    expect(ics).toContain('SUMMARY:Rehab\\, then stretch');
    expect(ics).toContain('SUMMARY:Roll your shoulders');
  });
});

describe('trkSlug', () => {
  test('makes url-safe tracker ids', () => {
    expect(core.trkSlug('Knee PT!')).toBe('knee-pt');
    expect(core.trkSlug('')).toBe('item');
  });
});
