const core = require('../../../frontend/views/trip/core');

function plan(overrides = {}) {
  return {
    schema: 1,
    trip: { title: 'T', start: '2027-04-05', end: '2027-04-08' },
    settings: { partySize: 6, rooms: 3, eurToUsd: 1.2, people: ['Ann', 'Ben'] },
    travelers: [],
    bases: [],
    days: [],
    decisions: [
      {
        id: 'hotel',
        title: 'Hotel',
        category: 'lodging',
        status: 'open',
        nights: 2,
        chosen: [],
        recommended: 'b',
        options: [
          { id: 'a', title: 'A', status: 'candidate', budgetCategory: 'lodging', votes: {},
            cost: { low: 100, high: 200, currency: 'EUR', unit: 'room-night' } },
          { id: 'b', title: 'B', status: 'candidate', budgetCategory: 'lodging', votes: {},
            cost: { low: 300, high: 300, currency: 'EUR', unit: 'room-night' } },
        ],
      },
    ],
    tasks: [{ id: 't1', kind: 'waiting', title: 'Wait', done: false }],
    comments: [],
    log: [],
    ...overrides,
  };
}

const NOW = '2026-11-14T10:00:00.000Z';
const apply = (p, op) => core.applyOp(p, op, NOW);

describe('ourCost', () => {
  const settings = { partySize: 6, rooms: 3 };

  test('room-night multiplies by nights and rooms', () => {
    const d = { nights: 2 };
    expect(core.ourCost({ cost: { low: 100, high: 200, currency: 'EUR', unit: 'room-night' } }, d, settings))
      .toEqual({ low: 600, high: 1200, currency: 'EUR' });
  });

  test('a decision can override rooms and people', () => {
    const d = { nights: 1, rooms: 1, people: 2 };
    expect(core.ourCost({ cost: { low: 100, high: 100, unit: 'room-night' } }, d, settings).low).toBe(100);
    expect(core.ourCost({ cost: { low: 50, high: 50, unit: 'person' } }, d, settings).low).toBe(100);
  });

  test('person multiplies by party size', () => {
    expect(core.ourCost({ cost: { low: 10, high: 20, unit: 'person' } }, {}, settings))
      .toEqual({ low: 60, high: 120, currency: 'EUR' });
  });

  test('group cost takes the decision share of a shared group', () => {
    const d = { shareOfGroup: 0.25 };
    expect(core.ourCost({ cost: { low: 1000, high: 2000, unit: 'group' } }, d, settings))
      .toEqual({ low: 250, high: 500, currency: 'EUR' });
    expect(core.ourCost({ cost: { low: 1000, high: 2000, unit: 'vehicle' } }, {}, settings).low).toBe(1000);
  });

  test('a missing high falls back to low; no cost gives null', () => {
    expect(core.ourCost({ cost: { low: 40, unit: 'party' } }, {}, settings)).toEqual({ low: 40, high: 40, currency: 'EUR' });
    expect(core.ourCost({}, {}, settings)).toBeNull();
    expect(core.ourCost({ cost: { note: 'unknown' } }, {}, settings)).toBeNull();
  });
});

describe('leadingOption', () => {
  test('chosen wins, then net votes, then the recommendation; rejected never leads', () => {
    const d = plan().decisions[0];
    expect(core.leadingOption(d).id).toBe('b');
    d.options[0].votes = { Ann: 1 };
    expect(core.leadingOption(d).id).toBe('a');
    d.options[0].status = 'rejected';
    expect(core.leadingOption(d).id).toBe('b');
    d.chosen = ['b'];
    d.options[0].status = 'candidate';
    expect(core.leadingOption(d).id).toBe('b');
  });

  test('null when nothing leads', () => {
    expect(core.leadingOption({ options: [{ id: 'x', votes: {} }], chosen: [] })).toBeNull();
  });
});

describe('tripDays and headcount', () => {
  test('lists every date from start to end with the base for that night', () => {
    const p = plan({ bases: [{ id: 'lk', name: 'Lakeside', from: '2027-04-06', to: '2027-04-08' }] });
    const days = core.tripDays(p);
    expect(days.map((d) => d.date)).toEqual(['2027-04-05', '2027-04-06', '2027-04-07', '2027-04-08']);
    expect(days.map((d) => d.base && d.base.id)).toEqual([null, 'lk', 'lk', null]);
    expect(days[0].weekday).toBe('Mon');
  });

  test('headcount sums the travelers present each day', () => {
    const p = plan({
      travelers: [
        { id: 'us', count: 2, from: '2027-04-05', to: '2027-04-08' },
        { id: 'friends', count: 16, from: '2027-04-06', to: '2027-04-07' },
      ],
    });
    expect(core.headcount(p, '2027-04-05')).toBe(2);
    expect(core.headcount(p, '2027-04-07')).toBe(18);
    expect(core.travelersOn(p, '2027-04-06').map((t) => t.id)).toEqual(['us', 'friends']);
  });
});

describe('budgetSummary', () => {
  test('uses chosen options as committed and leading options as projected, in USD', () => {
    const p = plan();
    let s = core.budgetSummary(p);
    // B leads via recommendation: 300 * 2 nights * 3 rooms = 1800 EUR -> 2160 USD
    expect(s.categories.lodging.projected).toEqual({ low: 2160, high: 2160 });
    expect(s.categories.lodging.committed).toEqual({ low: 0, high: 0 });

    p.decisions[0].chosen = ['a'];
    s = core.budgetSummary(p);
    expect(s.categories.lodging.committed).toEqual({ low: 720, high: 1440 });
    expect(s.categories.lodging.projected).toEqual({ low: 720, high: 1440 });
  });

  test('dropped decisions and options without cost are skipped and reported', () => {
    const p = plan();
    p.decisions.push({ id: 'x', status: 'open', chosen: [], options: [{ id: 'o', votes: {}, status: 'candidate' }], recommended: 'o' });
    p.decisions.push({ ...plan().decisions[0], id: 'gone', status: 'dropped' });
    const s = core.budgetSummary(p);
    expect(s.uncosted.map((d) => d.id)).toEqual(['x']);
    expect(s.categories.lodging.projected.low).toBe(2160);
  });

  test('decisions marked excludeFromBudget are left out (e.g. a strategy that overlaps others)', () => {
    const p = plan();
    p.decisions[0].excludeFromBudget = true;
    const s = core.budgetSummary(p);
    expect(s.categories).toEqual({});
    expect(s.uncosted).toEqual([]);
  });

  test('USD costs are not converted', () => {
    const p = plan();
    p.decisions[0].options[1].cost = { low: 100, high: 100, currency: 'USD', unit: 'party' };
    expect(core.budgetSummary(p).categories.lodging.projected.low).toBe(100);
  });
});

describe('applyOp', () => {
  test('vote sets, changes and clears a person vote and logs it', () => {
    let p = apply(plan(), { type: 'vote', who: 'Ben', decisionId: 'hotel', optionId: 'a', value: 1 });
    expect(p.decisions[0].options[0].votes).toEqual({ Ben: 1 });
    p = apply(p, { type: 'vote', who: 'Ben', decisionId: 'hotel', optionId: 'a', value: 0 });
    expect(p.decisions[0].options[0].votes).toEqual({});
    expect(p.log[0]).toMatchObject({ at: NOW, who: 'Ben' });
  });

  test('does not mutate its input', () => {
    const original = plan();
    apply(original, { type: 'vote', who: 'Ben', decisionId: 'hotel', optionId: 'a', value: 1 });
    expect(original.decisions[0].options[0].votes).toEqual({});
  });

  test('choose on a single decision replaces, marks decided, and clears with null', () => {
    let p = apply(plan(), { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'a' });
    expect(p.decisions[0].chosen).toEqual(['a']);
    expect(p.decisions[0].status).toBe('decided');
    p = apply(p, { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'b' });
    expect(p.decisions[0].chosen).toEqual(['b']);
    p = apply(p, { type: 'choose', who: 'F', decisionId: 'hotel', optionId: null });
    expect(p.decisions[0].chosen).toEqual([]);
    expect(p.decisions[0].status).toBe('open');
  });

  test('choose on a multi decision toggles membership', () => {
    const base = plan();
    base.decisions[0].multi = true;
    let p = apply(base, { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'a' });
    p = apply(p, { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'b' });
    expect(p.decisions[0].chosen).toEqual(['a', 'b']);
    p = apply(p, { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'a' });
    expect(p.decisions[0].chosen).toEqual(['b']);
  });

  test('choose keeps a booked status', () => {
    const base = plan();
    base.decisions[0].status = 'booked';
    expect(apply(base, { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'a' }).decisions[0].status).toBe('booked');
  });

  test('rejecting a chosen option unchooses it', () => {
    let p = apply(plan(), { type: 'choose', who: 'F', decisionId: 'hotel', optionId: 'a' });
    p = apply(p, { type: 'setOptionStatus', who: 'F', decisionId: 'hotel', optionId: 'a', status: 'rejected' });
    expect(p.decisions[0].options[0].status).toBe('rejected');
    expect(p.decisions[0].chosen).toEqual([]);
  });

  test('setDecisionStatus validates the status', () => {
    const p = apply(plan(), { type: 'setDecisionStatus', who: 'F', decisionId: 'hotel', status: 'booked' });
    expect(p.decisions[0].status).toBe('booked');
    expect(() => apply(plan(), { type: 'setDecisionStatus', who: 'F', decisionId: 'hotel', status: 'nah' })).toThrow(/status/);
  });

  test('comment adds an unresolved comment; resolveComment toggles it', () => {
    let p = apply(plan(), { type: 'comment', who: 'Ben', decisionId: 'hotel', optionId: 'a', text: '  too far  ' });
    expect(p.comments).toHaveLength(1);
    expect(p.comments[0]).toMatchObject({ who: 'Ben', decisionId: 'hotel', optionId: 'a', text: 'too far', resolved: false, at: NOW });
    p = apply(p, { type: 'resolveComment', who: 'F', commentId: p.comments[0].id });
    expect(p.comments[0].resolved).toBe(true);
  });

  test('a general comment needs no decision', () => {
    const p = apply(plan(), { type: 'comment', who: 'F', text: 'Overall thought' });
    expect(p.comments[0].decisionId).toBeNull();
  });

  test('addOption appends a candidate added by the person', () => {
    const p = apply(plan(), { type: 'addOption', who: 'Ben', decisionId: 'hotel', title: 'Villa X', summary: 'Saw it', url: 'https://x.example' });
    const o = p.decisions[0].options[2];
    expect(o).toMatchObject({ title: 'Villa X', summary: 'Saw it', status: 'candidate', addedBy: 'Ben', votes: {} });
    expect(o.links).toEqual([{ label: 'Link', url: 'https://x.example' }]);
    expect(o.id).toMatch(/^villa-x/);
  });

  test('addOption rejects non-http links', () => {
    expect(() => apply(plan(), { type: 'addOption', who: 'N', decisionId: 'hotel', title: 'X', url: 'javascript:alert(1)' })).toThrow(/url/i);
  });

  test('toggleTask flips done', () => {
    const p = apply(plan(), { type: 'toggleTask', who: 'F', taskId: 't1' });
    expect(p.tasks[0].done).toBe(true);
  });

  test('setSetting only accepts known numeric settings', () => {
    expect(apply(plan(), { type: 'setSetting', who: 'F', key: 'eurToUsd', value: 1.1 }).settings.eurToUsd).toBe(1.1);
    expect(() => apply(plan(), { type: 'setSetting', who: 'F', key: 'people', value: 1 })).toThrow(/setting/);
    expect(() => apply(plan(), { type: 'setSetting', who: 'F', key: 'rooms', value: -1 })).toThrow(/setting/);
  });

  test('rejects unknown ops, unknown ids, missing who and empty text', () => {
    expect(() => apply(plan(), { type: 'explode', who: 'F' })).toThrow(/unknown op/i);
    expect(() => apply(plan(), { type: 'vote', who: 'F', decisionId: 'nope', optionId: 'a', value: 1 })).toThrow(/decision/);
    expect(() => apply(plan(), { type: 'vote', who: 'F', decisionId: 'hotel', optionId: 'nope', value: 1 })).toThrow(/option/);
    expect(() => apply(plan(), { type: 'vote', decisionId: 'hotel', optionId: 'a', value: 1 })).toThrow(/who/);
    expect(() => apply(plan(), { type: 'vote', who: 'F', decisionId: 'hotel', optionId: 'a', value: 5 })).toThrow(/value/);
    expect(() => apply(plan(), { type: 'comment', who: 'F', text: '   ' })).toThrow(/text/);
  });

  test('the log is capped', () => {
    let p = plan();
    for (let i = 0; i < core.LOG_LIMIT + 5; i++) p = apply(p, { type: 'toggleTask', who: 'F', taskId: 't1' });
    expect(p.log).toHaveLength(core.LOG_LIMIT);
  });
});

describe('scenarios (whole-itinerary alternatives)', () => {
  function scenarioPlan() {
    const p = plan({
      trip: { title: 'T', start: '2027-04-05', end: '2027-04-08' },
      bases: [{ id: 'a', name: 'A', from: '2027-04-05', to: '2027-04-08' }],
      days: [{ date: '2027-04-05', items: [{ title: 'base day' }] }, { date: '2027-04-06', items: [{ title: 'A only' }] }],
    });
    p.decisions.push({
      id: 'shape', status: 'open', chosen: [], recommended: 'plan-a',
      options: [
        { id: 'plan-a', title: 'Plan A', votes: {}, status: 'candidate' },
        { id: 'plan-b', title: 'Plan B', votes: {}, status: 'candidate', scenario: {
          bases: [{ id: 'a', name: 'A', from: '2027-04-05', to: '2027-04-06' }, { id: 'b', name: 'B', from: '2027-04-06', to: '2027-04-08' }],
          days: [{ date: '2027-04-06', items: [{ title: 'B only' }] }],
        } },
      ],
    });
    return p;
  }

  test('scenarioDecision finds the decision whose options carry scenarios', () => {
    expect(core.scenarioDecision(scenarioPlan()).id).toBe('shape');
    expect(core.scenarioDecision(plan())).toBeNull();
  });

  test('withScenario swaps in the bases and overrides days by date', () => {
    const p = core.withScenario(scenarioPlan(), 'plan-b');
    const days = core.tripDays(p);
    expect(days.map((d) => d.base && d.base.id)).toEqual(['a', 'b', 'b', null]);
    expect(days[0].items[0].title).toBe('base day');
    expect(days[1].items[0].title).toBe('B only');
  });

  test('an option without a scenario, or an unknown id, leaves the plan as is', () => {
    const base = scenarioPlan();
    expect(core.tripDays(core.withScenario(base, 'plan-a'))[1].items[0].title).toBe('A only');
    expect(core.withScenario(base, 'nope').bases).toEqual(base.bases);
    expect(core.withScenario(plan(), null).bases).toEqual([]);
  });

  test('defaults to the leading option of the scenario decision', () => {
    const p = scenarioPlan();
    p.decisions[1].chosen = ['plan-b'];
    expect(core.tripDays(core.withScenario(p))[1].items[0].title).toBe('B only');
  });
});

describe('hash routing (#entry=<path>&tab=…)', () => {
  test('parseHash reads key=value pairs, decoding values', () => {
    expect(core.parseHash('#entry=travel/trips/x/planner.md&tab=calendar'))
      .toEqual({ entry: 'travel/trips/x/planner.md', tab: 'calendar' });
    expect(core.parseHash('#entry=a%2Fb.md&decision=d%201')).toEqual({ entry: 'a/b.md', decision: 'd 1' });
    expect(core.parseHash('')).toEqual({});
    expect(core.parseHash('#overview')).toEqual({});
    expect(core.parseHash('#entry=%E0%A4%A')).toEqual({});
  });

  test('a Supabase OAuth hash has no entry', () => {
    expect(core.parseHash('#access_token=abc&refresh_token=def&type=bearer').entry).toBeUndefined();
  });

  test('hashFor keeps the entry first, slashes readable, and drops empty values', () => {
    expect(core.hashFor({ entry: 'travel/trips/x/planner.md', tab: 'budget' })).toBe('#entry=travel/trips/x/planner.md&tab=budget');
    expect(core.hashFor({ entry: 'a/b.md', research: 'a/c & d.md', tab: null })).toBe('#entry=a/b.md&research=a/c%20%26%20d.md');
    const round = core.parseHash(core.hashFor({ entry: 'a/b.md', decision: 'x&y=z' }));
    expect(round).toEqual({ entry: 'a/b.md', decision: 'x&y=z' });
  });

  test('normalizeEntryPath accepts a trip folder as shorthand for its planner.md', () => {
    expect(core.normalizeEntryPath('travel/trips/x/planner.md')).toBe('travel/trips/x/planner.md');
    expect(core.normalizeEntryPath('travel/trips/x/')).toBe('travel/trips/x/planner.md');
    expect(core.normalizeEntryPath('travel/trips/x')).toBe('travel/trips/x/planner.md');
    expect(core.normalizeEntryPath('  ')).toBeNull();
    expect(core.normalizeEntryPath(undefined)).toBeNull();
  });
});
