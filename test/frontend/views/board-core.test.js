// Pure logic behind the TODO board (frontend/views/board/core.js).
const B = require('../../../frontend/views/board/core');

const t = (name, extra) => Object.assign({ name, status: 'active', priority: 'P2', due: null, scheduled_date: null, category: null, summary: '' }, extra);

describe('dates', () => {
  test('localToday formats a local date as YYYY-MM-DD', () => {
    expect(B.localToday(new Date(2030, 0, 5, 23, 30))).toBe('2030-01-05');
  });
  test('addDays crosses month and year ends', () => {
    expect(B.addDays('2030-01-30', 3)).toBe('2030-02-02');
    expect(B.addDays('2030-12-31', 1)).toBe('2031-01-01');
  });
  test('isOverdue only when due is before today', () => {
    expect(B.isOverdue(t('a', { due: '2030-01-04' }), '2030-01-05')).toBe(true);
    expect(B.isOverdue(t('a', { due: '2030-01-05' }), '2030-01-05')).toBe(false);
    expect(B.isOverdue(t('a'), '2030-01-05')).toBe(false);
  });
});

describe('sorting and grouping', () => {
  test('sortCards: priority, then due (none last), then name', () => {
    const rows = [
      t('d', { priority: 'P2' }),
      t('c', { priority: 'P1', due: null }),
      t('b', { priority: 'P1', due: '2030-02-01' }),
      t('a', { priority: 'P1', due: '2030-01-01' }),
      t('e', { priority: null }),
      t('z', { priority: 'P0' }),
      t('y', { priority: 'P2' }),
    ];
    expect(B.sortCards(rows).map((r) => r.name)).toEqual(['z', 'a', 'b', 'c', 'd', 'y', 'e']);
    expect(rows[0].name).toBe('d'); // input untouched
  });

  test('groupByStatus puts every status in its column, sorted, and skips unknown ones', () => {
    const g = B.groupByStatus([
      t('a', { status: 'inbox', priority: 'P3' }),
      t('b', { status: 'inbox', priority: 'P0' }),
      t('c', { status: 'scheduled', scheduled_date: '2030-01-01' }),
      t('d', { status: 'weird' }),
    ]);
    expect(Object.keys(g)).toEqual(['inbox', 'active', 'later', 'scheduled']);
    expect(g.inbox.map((r) => r.name)).toEqual(['b', 'a']);
    expect(g.active).toEqual([]);
    expect(g.scheduled.map((r) => r.name)).toEqual(['c']);
  });
});

describe('status changes keep scheduled_date iff scheduled', () => {
  test('moving to a non-scheduled status clears scheduled_date', () => {
    expect(B.statusChange(t('a', { status: 'scheduled', scheduled_date: '2030-01-01' }), 'active'))
      .toEqual({ status: 'active', scheduled_date: null });
    expect(B.statusChange(t('a', { status: 'inbox' }), 'later')).toEqual({ status: 'later', scheduled_date: null });
  });
  test('moving to scheduled needs a valid date', () => {
    expect(() => B.statusChange(t('a'), 'scheduled')).toThrow(/date/i);
    expect(() => B.statusChange(t('a'), 'scheduled', '2030-13-01')).toThrow(/date/i);
    expect(() => B.statusChange(t('a'), 'scheduled', 'tomorrow')).toThrow(/date/i);
    expect(B.statusChange(t('a'), 'scheduled', '2030-02-01')).toEqual({ status: 'scheduled', scheduled_date: '2030-02-01' });
  });
  test('rescheduling a scheduled TODO to a new date is a change', () => {
    expect(B.statusChange(t('a', { status: 'scheduled', scheduled_date: '2030-01-01' }), 'scheduled', '2030-03-01'))
      .toEqual({ status: 'scheduled', scheduled_date: '2030-03-01' });
  });
  test('same status (and same date) is a no-op', () => {
    expect(B.statusChange(t('a'), 'active')).toBeNull();
    expect(B.statusChange(t('a', { status: 'scheduled', scheduled_date: '2030-01-01' }), 'scheduled', '2030-01-01')).toBeNull();
  });
  test('unknown statuses (including archived) are rejected', () => {
    expect(() => B.statusChange(t('a'), 'archived')).toThrow(/status/i);
    expect(() => B.statusChange(t('a'), 'done')).toThrow(/status/i);
  });
});

describe('quick edits', () => {
  test('priorityChange validates and skips no-ops', () => {
    expect(B.priorityChange(t('a'), 'P0')).toEqual({ priority: 'P0' });
    expect(B.priorityChange(t('a'), 'P2')).toBeNull();
    expect(() => B.priorityChange(t('a'), 'P9')).toThrow(/priority/i);
  });
  test('dueChange sets, clears and validates', () => {
    expect(B.dueChange(t('a'), '2030-04-01')).toEqual({ due: '2030-04-01' });
    expect(B.dueChange(t('a', { due: '2030-04-01' }), '')).toEqual({ due: null });
    expect(B.dueChange(t('a', { due: '2030-04-01' }), '2030-04-01')).toBeNull();
    expect(B.dueChange(t('a'), '')).toBeNull();
    expect(() => B.dueChange(t('a'), '04/01/2030')).toThrow(/date/i);
  });
});

describe('filters', () => {
  const rows = [
    t('fix-roof', { priority: 'P1', category: 'home', summary: 'Call the roofer' }),
    t('tax-return', { priority: 'P0', category: 'finance', summary: 'File taxes' }),
    t('paint-fence', { priority: 'P1', category: 'home', summary: 'Buy paint' }),
    t('no-cat', { priority: 'P3', category: null }),
  ];
  test('by priority, category and text over name and summary (case-insensitive)', () => {
    expect(B.filterTodos(rows, {}).length).toBe(4);
    expect(B.filterTodos(rows, { priority: 'P1' }).map((r) => r.name)).toEqual(['fix-roof', 'paint-fence']);
    expect(B.filterTodos(rows, { category: 'home', q: 'ROOF' }).map((r) => r.name)).toEqual(['fix-roof']);
    expect(B.filterTodos(rows, { q: 'paint' }).map((r) => r.name)).toEqual(['paint-fence']);
    expect(B.filterTodos(rows, { q: 'taxes' }).map((r) => r.name)).toEqual(['tax-return']);
    expect(B.filterTodos(rows, { q: 'home' })).toEqual([]); // category is not text-searched
  });
  test('categories lists the distinct non-empty ones, sorted', () => {
    expect(B.categories(rows)).toEqual(['finance', 'home']);
  });
});

describe('due buckets', () => {
  test('overdue, today and the next 7 days, each sorted by date then priority', () => {
    const today = '2030-01-10';
    const b = B.dueBuckets([
      t('old', { due: '2030-01-01' }),
      t('older', { due: '2029-12-01' }),
      t('now-p2', { due: today }),
      t('now-p0', { due: today, priority: 'P0' }),
      t('day7', { due: '2030-01-17' }),
      t('day1', { due: '2030-01-11' }),
      t('day8', { due: '2030-01-18' }),
      t('none'),
    ], today);
    expect(b.overdue.map((r) => r.name)).toEqual(['older', 'old']);
    expect(b.today.map((r) => r.name)).toEqual(['now-p0', 'now-p2']);
    expect(b.soon.map((r) => r.name)).toEqual(['day1', 'day7']);
  });
});

describe('hash', () => {
  test('round-trips the filters', () => {
    const f = { priority: 'P1', category: 'home & garden', q: 'roof leak' };
    const hash = B.hashFor(f);
    expect(hash).toMatch(/^#/);
    expect(B.parseHash(hash)).toEqual(f);
  });
  test('empty filters give an empty hash, and bad or foreign values are ignored', () => {
    expect(B.hashFor({})).toBe('');
    expect(B.hashFor({ priority: '', category: '', q: '  ' })).toBe('');
    expect(B.parseHash('')).toEqual({ priority: '', category: '', q: '' });
    expect(B.parseHash('#priority=P7&access_token=abc')).toEqual({ priority: '', category: '', q: '' });
  });
});
