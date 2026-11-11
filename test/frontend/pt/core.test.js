const core = require('../../../frontend/pt/pt-core.js');

const NY = 'America/New_York';

describe('ptLocalDate', () => {
  test('formats the local calendar date in the given time zone', () => {
    // 03:00 UTC on Nov 11 is still Nov 10 in New York.
    expect(core.ptLocalDate(Date.UTC(2026, 10, 11, 3, 0), NY)).toBe('2026-11-10');
    expect(core.ptLocalDate(Date.UTC(2026, 10, 11, 3, 0), 'UTC')).toBe('2026-11-11');
  });
});

describe('ptZonedTimeToMs', () => {
  test('converts a wall-clock time in a zone to an instant (standard time)', () => {
    expect(core.ptZonedTimeToMs('2026-11-11', '08:30', NY)).toBe(Date.UTC(2026, 10, 11, 13, 30));
  });

  test('handles daylight saving time', () => {
    expect(core.ptZonedTimeToMs('2026-07-01', '08:30', NY)).toBe(Date.UTC(2026, 6, 1, 12, 30));
  });
});

describe('ptBuildEntry', () => {
  const now = Date.UTC(2026, 10, 11, 14, 0);

  test('builds a morning entry with both knees', () => {
    const e = core.ptBuildEntry('morning', { pain_right: 4, pain_left: 2 }, now, NY);
    expect(e).toEqual({
      kind: 'morning',
      occurred_at: new Date(now).toISOString(),
      entry_date: '2026-11-11',
      pain_right: 4,
      pain_left: 2,
    });
  });

  test('builds a flare with pain, side, trigger and a trimmed note', () => {
    const e = core.ptBuildEntry('flare', { pain: 6, side: 'right', trigger: 'car', note: '  long drive ' }, now, NY);
    expect(e).toMatchObject({ kind: 'flare', pain: 6, side: 'right', trigger: 'car', note: 'long drive' });
  });

  test('drops an empty note', () => {
    const e = core.ptBuildEntry('flare', { pain: 3, side: 'both', trigger: 'sitting', note: '   ' }, now, NY);
    expect(e).not.toHaveProperty('note');
  });

  test('builds a lift entry with what was lifted', () => {
    const e = core.ptBuildEntry('lift', { lift_notes: 'squats 3x5 light, bench' }, now, NY);
    expect(e).toMatchObject({ kind: 'lift', lift_notes: 'squats 3x5 light, bench' });
  });

  test('builds an exercise entry that keeps the exercise name', () => {
    const e = core.ptBuildEntry('exercise', { exercise_id: 'knee-stretch', exercise_name: 'Knee stretch' }, now, NY);
    expect(e).toMatchObject({ kind: 'exercise', exercise_id: 'knee-stretch', exercise_name: 'Knee stretch' });
  });

  test.each([
    ['morning', { pain_right: 11, pain_left: 2 }, /pain_right/],
    ['morning', { pain_right: 3 }, /pain_left/],
    ['morning', { pain_right: 2.5, pain_left: 1 }, /pain_right/],
    ['flare', { pain: 5, side: 'right' }, /trigger/],
    ['flare', { pain: 5, side: 'right', trigger: 'gardening' }, /trigger/],
    ['flare', { pain: 5, side: 'middle', trigger: 'car' }, /side/],
    ['flare', { side: 'right', trigger: 'car' }, /pain/],
    ['exercise', {}, /exercise_id/],
    ['nap', {}, /kind/],
  ])('rejects invalid %s entry %j', (kind, fields, err) => {
    expect(() => core.ptBuildEntry(kind, fields, now, NY)).toThrow(err);
  });
});

describe('ptNormalizeSettings', () => {
  test('fills defaults for missing settings', () => {
    const s = core.ptNormalizeSettings(null);
    expect(s.exercises.length).toBeGreaterThan(0);
    expect(s.reminders.length).toBeGreaterThan(0);
    expect(s.sitting).toMatchObject({ enabled: expect.any(Boolean), every_minutes: expect.any(Number) });
  });

  test('default exercises include the daily knee stretch and optional rehab-plan items', () => {
    const s = core.ptDefaultSettings();
    const stretch = s.exercises.find((e) => /knee extension/i.test(e.name));
    expect(stretch.optional).toBe(false);
    expect(s.exercises.some((e) => e.optional)).toBe(true);
  });

  test('rejects malformed times and empty names', () => {
    const base = core.ptDefaultSettings();
    expect(() => core.ptNormalizeSettings({ ...base, reminders: [{ id: 'a', label: 'x', time: '25:00', days: [1] }] }))
      .toThrow(/time/);
    expect(() => core.ptNormalizeSettings({ ...base, exercises: [{ id: 'a', name: '  ' }] }))
      .toThrow(/name/);
    expect(() => core.ptNormalizeSettings({ ...base, sitting: { enabled: true, every_minutes: 5, start: '09:00', end: '17:00', days: [1] } }))
      .toThrow(/every_minutes/);
  });

  test('assigns ids to new exercises and reminders', () => {
    const s = core.ptNormalizeSettings({
      ...core.ptDefaultSettings(),
      exercises: [{ name: 'Glute bridges' }],
      reminders: [{ label: 'Stretch', time: '7:05', days: [1, 2] }],
    });
    expect(s.exercises[0].id).toBe('glute-bridges');
    expect(s.reminders[0].id).toBeTruthy();
    expect(s.reminders[0].time).toBe('07:05');
    expect(s.reminders[0].enabled).toBe(true);
  });
});

describe('ptReminderTimes', () => {
  const settings = core.ptNormalizeSettings({
    timezone: NY,
    exercises: [{ id: 'x', name: 'X' }],
    reminders: [
      { id: 'pt', label: 'PT stretch', time: '12:30', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'wk', label: 'Weekend only', time: '10:00', days: [0, 6] },
      { id: 'off', label: 'Disabled', time: '11:00', days: [3], enabled: false },
    ],
    sitting: { enabled: true, every_minutes: 45, start: '09:00', end: '11:00', days: [1, 2, 3, 4, 5] },
  });

  test('lists a weekday\'s reminders and sitting breaks in time order', () => {
    // 2026-11-11 is a Wednesday.
    const times = core.ptReminderTimes(settings, '2026-11-11');
    expect(times.map((t) => t.time + ' ' + t.kind)).toEqual([
      '09:45 sitting',
      '10:30 sitting',
      '12:30 reminder',
    ]);
  });

  test('weekend has no sitting breaks but has the weekend reminder', () => {
    const times = core.ptReminderTimes(settings, '2026-11-14');
    expect(times.map((t) => t.label)).toEqual(['Weekend only', 'PT stretch']);
  });
});

describe('ptRemindersDue', () => {
  const settings = core.ptNormalizeSettings({
    timezone: NY,
    exercises: [{ id: 'x', name: 'X' }],
    reminders: [{ id: 'pt', label: 'PT stretch', time: '12:30', days: [0, 1, 2, 3, 4, 5, 6] }],
    sitting: { enabled: false, every_minutes: 45, start: '09:00', end: '17:00', days: [] },
  });
  const fire = Date.UTC(2026, 10, 11, 17, 30); // 12:30 in New York

  test('returns reminders whose fire time falls in (from, to]', () => {
    const due = core.ptRemindersDue(settings, fire - 15 * 60000, fire);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ id: 'pt', label: 'PT stretch', at: fire });
  });

  test('excludes a fire time equal to `from` so consecutive windows never double-send', () => {
    expect(core.ptRemindersDue(settings, fire, fire + 15 * 60000)).toHaveLength(0);
  });

  test('works across a local midnight', () => {
    const s = core.ptNormalizeSettings({ ...settings, reminders: [{ id: 'm', label: 'Midnight', time: '00:00', days: [4] }] });
    const midnight = core.ptZonedTimeToMs('2026-11-12', '00:00', NY);
    expect(core.ptRemindersDue(s, midnight - 600000, midnight + 600000)).toHaveLength(1);
  });
});

describe('ptNextReminder', () => {
  test('finds the next fire time, looking into following days', () => {
    const settings = core.ptNormalizeSettings({
      timezone: NY,
      exercises: [{ id: 'x', name: 'X' }],
      reminders: [{ id: 'pt', label: 'PT stretch', time: '08:00', days: [1] }],
      sitting: { enabled: false, every_minutes: 45, start: '09:00', end: '17:00', days: [] },
    });
    // Wed 2026-11-11 noon NY -> next Monday 2026-11-16 08:00 NY.
    const next = core.ptNextReminder(settings, Date.UTC(2026, 10, 11, 17, 0));
    expect(next.at).toBe(core.ptZonedTimeToMs('2026-11-16', '08:00', NY));
  });

  test('returns null when nothing is scheduled', () => {
    const s = core.ptNormalizeSettings({ ...core.ptDefaultSettings(), reminders: [], sitting: { enabled: false, every_minutes: 45, start: '09:00', end: '17:00', days: [] } });
    expect(core.ptNextReminder(s, Date.now())).toBeNull();
  });
});

describe('ptSummarize', () => {
  const entries = [
    { kind: 'morning', entry_date: '2026-11-09', pain_right: 4, pain_left: 2 },
    { kind: 'lift', entry_date: '2026-11-09', lift_notes: 'squats' },
    { kind: 'flare', entry_date: '2026-11-09', pain: 5, trigger: 'after_lift' },
    { kind: 'flare', entry_date: '2026-11-09', pain: 7, trigger: 'car' },
    { kind: 'morning', entry_date: '2026-11-10', pain_right: 6, pain_left: 3 },
    { kind: 'flare', entry_date: '2026-11-10', pain: 4, trigger: 'car' },
    { kind: 'exercise', entry_date: '2026-11-10', exercise_id: 'x' },
    { kind: 'morning', entry_date: '2026-11-11', pain_right: 3, pain_left: 3 },
  ];

  test('builds one row per day, oldest first, including empty days', () => {
    const s = core.ptSummarize(entries, '2026-11-11', 4);
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    expect(s.days[0]).toMatchObject({ morningRight: null, morningLeft: null, flares: 0, lift: false });
    expect(s.days[1]).toMatchObject({ morningRight: 4, morningLeft: 2, flares: 2, maxFlare: 7, lift: true, liftNotes: 'squats' });
    expect(s.days[2]).toMatchObject({ flares: 1, exercises: 1, lift: false });
  });

  test('counts triggers, most frequent first', () => {
    const s = core.ptSummarize(entries, '2026-11-11', 4);
    expect(s.triggers[0]).toMatchObject({ id: 'car', count: 2 });
    expect(s.triggers.find((t) => t.id === 'after_lift').count).toBe(1);
    expect(s.triggers.every((t) => t.count > 0)).toBe(true);
  });

  test('compares lift days with other days', () => {
    const s = core.ptSummarize(entries, '2026-11-11', 4);
    expect(s.lift.liftDays).toBe(1);
    expect(s.lift.flaresPerLiftDay).toBe(2);
    expect(s.lift.flaresPerOtherDay).toBeCloseTo(1 / 3);
    // The morning after the lift day (11-10) the worse knee was 6.
    expect(s.lift.nextMorningAfterLift).toBe(6);
    // Mornings after non-lift days with a logged next morning: 11-09 (after 11-08) = 4, 11-11 (after 11-10) = 3.
    expect(s.lift.nextMorningAfterOther).toBe(3.5);
  });

  test('uses the latest morning entry when a day has two', () => {
    const s = core.ptSummarize([
      { kind: 'morning', entry_date: '2026-11-11', occurred_at: '2026-11-11T12:00:00Z', pain_right: 2, pain_left: 2 },
      { kind: 'morning', entry_date: '2026-11-11', occurred_at: '2026-11-11T13:00:00Z', pain_right: 5, pain_left: 1 },
    ], '2026-11-11', 1);
    expect(s.days[0]).toMatchObject({ morningRight: 5, morningLeft: 1 });
  });
});

describe('ptBuildIcs', () => {
  const settings = core.ptNormalizeSettings({
    timezone: NY,
    exercises: [{ id: 'x', name: 'X' }],
    reminders: [{ id: 'pt', label: 'PT stretch, then back', time: '12:30', days: [1, 3, 5] }],
    sitting: { enabled: true, every_minutes: 60, start: '09:00', end: '11:00', days: [1, 2, 3, 4, 5] },
  });
  const ics = core.ptBuildIcs(settings, '2026-11-11');

  test('is a calendar with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  test('has one weekly recurring event with an alarm per reminder time', () => {
    const events = ics.split('BEGIN:VEVENT').length - 1;
    expect(events).toBe(3); // PT + sitting at 10:00 and 11:00
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(ics).toContain('DTSTART;TZID=America/New_York:20261111T123000');
    expect(ics).toContain('SUMMARY:PT stretch\\, then back');
    expect(ics.split('BEGIN:VALARM').length - 1).toBe(3);
  });
});
