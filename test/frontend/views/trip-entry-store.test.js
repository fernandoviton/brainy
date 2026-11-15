const core = require('../../../frontend/views/trip/core');
const { parseEntry, serializeEntry, createEntryStore } = require('../../../frontend/views/trip/entry-store');
const { createMockClient } = require('../../../frontend/views/trip/mock-client');

const PATH = 'trip/planner.md';
const PREAMBLE = '# Planner data\n\nEdit the JSON below.\n\n';
const PLAN = {
  schema: 1,
  settings: { partySize: 4, rooms: 2, eurToUsd: 1.2 },
  decisions: [{ id: 'd', status: 'open', chosen: [], options: [{ id: 'o', votes: {}, status: 'candidate' }] }],
  tasks: [],
  comments: [],
  log: [],
};
const NOW = '2026-11-14T00:00:00.000Z';

function seed(extra) {
  return [
    { path: PATH, topic: 'planner', summary: 'S', content: serializeEntry(PLAN, PREAMBLE, '\n'), updated_at: '2026-11-01T00:00:00.000Z' },
    { path: 'trip.md', topic: 't', summary: 'Prose', content: '# Trip', updated_at: '2026-11-01T00:00:00.000Z' },
    { path: 'other/x.md', topic: 'x', summary: '', content: '# X', updated_at: '2026-11-01T00:00:00.000Z' },
    ...(extra || []),
  ];
}

function makeStore(client, opts) {
  return createEntryStore({ client, apply: core.applyOp, now: () => NOW, ...opts });
}

const vote = (who, value) => ({ type: 'vote', who, decisionId: 'd', optionId: 'o', value });
const planIn = (client) => parseEntry(client.rows.find((r) => r.path === PATH).content).plan;

describe('parseEntry / serializeEntry', () => {
  test('parses the first json fence and keeps the preamble and trailer', () => {
    const content = PREAMBLE + '```json\n' + JSON.stringify(PLAN) + '\n```\n\nTrailing notes.\n';
    const parsed = parseEntry(content);
    expect(parsed.plan).toEqual(PLAN);
    expect(parsed.preamble).toBe(PREAMBLE);
    expect(parsed.trailer).toBe('\n\nTrailing notes.\n');
  });

  test('round-trips with pretty JSON, preamble and trailer intact', () => {
    const content = serializeEntry(PLAN, PREAMBLE, '\n\nTrailing.\n');
    expect(content).toContain('```json\n{\n  "schema": 1');
    const parsed = parseEntry(content);
    expect(parsed.plan).toEqual(PLAN);
    expect(serializeEntry(parsed.plan, parsed.preamble, parsed.trailer)).toBe(content);
  });

  test('missing fence or bad JSON is a clear error', () => {
    expect(() => parseEntry('# nothing here')).toThrow(/json block/i);
    expect(() => parseEntry('```json\n{bad\n```')).toThrow(/invalid json/i);
  });
});

describe('entry store', () => {
  test('load returns the parsed plan, preamble and updatedAt', async () => {
    const store = makeStore(createMockClient(seed()));
    const entry = await store.load(PATH);
    expect(entry.plan).toEqual(PLAN);
    expect(entry.preamble).toBe(PREAMBLE);
    expect(entry.updatedAt).toBe('2026-11-01T00:00:00.000Z');
  });

  test('load reports a missing entry by path', async () => {
    const store = makeStore(createMockClient(seed()));
    await expect(store.load('nope/planner.md')).rejects.toThrow(/nope\/planner\.md.*not found/);
  });

  test('load surfaces a Supabase error', async () => {
    const client = createMockClient(seed());
    client.failNext = { message: 'JWT expired' };
    await expect(makeStore(client).load(PATH)).rejects.toThrow(/JWT expired/);
  });

  test('applyOp applies the op and writes the entry back, keeping preamble, topic and summary', async () => {
    const client = createMockClient(seed());
    const store = makeStore(client);
    const result = await store.applyOp(PATH, vote('Ann', 1));
    expect(result.plan.decisions[0].options[0].votes).toEqual({ Ann: 1 });
    const row = client.rows.find((r) => r.path === PATH);
    expect(row).toMatchObject({ topic: 'planner', summary: 'S' });
    expect(row.content.startsWith(PREAMBLE)).toBe(true);
    expect(planIn(client).log[0]).toMatchObject({ at: NOW, who: 'Ann' });
    expect(result.updatedAt).toBe(row.updated_at);
    expect(result.updatedAt).not.toBe('2026-11-01T00:00:00.000Z');
  });

  test('the update is conditional on the updated_at that was read', async () => {
    const client = createMockClient(seed());
    await makeStore(client).applyOp(PATH, vote('Ann', 1));
    const update = client.calls.find((c) => c.op === 'update');
    expect(update.filters).toEqual([['eq', 'path', PATH], ['eq', 'updated_at', '2026-11-01T00:00:00.000Z']]);
    expect(Object.keys(update.values)).toEqual(['content']);
  });

  test('on a conflict (0 rows updated) it re-reads and re-applies on top of the other edit', async () => {
    const client = createMockClient(seed());
    let edits = 0;
    client.beforeUpdate = () => {
      // Someone else (CLI, agent) saves between our read and our write, once.
      if (edits++ > 0) return;
      const row = client.rows.find((r) => r.path === PATH);
      const other = core.applyOp(parseEntry(row.content).plan, vote('Ben', -1), NOW);
      row.content = serializeEntry(other, PREAMBLE, '\n');
      row.updated_at = '2026-11-02T00:00:00.000Z';
    };
    const result = await makeStore(client).applyOp(PATH, vote('Ann', 1));
    expect(result.plan.decisions[0].options[0].votes).toEqual({ Ben: -1, Ann: 1 });
    expect(planIn(client).decisions[0].options[0].votes).toEqual({ Ben: -1, Ann: 1 });
    expect(client.calls.filter((c) => c.op === 'update')).toHaveLength(2);
  });

  test('gives up after the retry limit with a clear error and nothing of ours written', async () => {
    const client = createMockClient(seed());
    let n = 0;
    client.beforeUpdate = () => {
      const row = client.rows.find((r) => r.path === PATH);
      row.updated_at = `2026-11-02T00:00:0${n++}.000Z`;
    };
    const store = makeStore(client, { maxAttempts: 3 });
    await expect(store.applyOp(PATH, vote('Ann', 1))).rejects.toThrow(/kept changing.*reload/i);
    expect(client.calls.filter((c) => c.op === 'update')).toHaveLength(3);
    expect(planIn(client).decisions[0].options[0].votes).toEqual({});
  });

  test('an invalid op is rejected and nothing is written', async () => {
    const client = createMockClient(seed());
    await expect(makeStore(client).applyOp(PATH, { type: 'vote', who: 'A', decisionId: 'zzz', optionId: 'o', value: 1 }))
      .rejects.toThrow(/decision/);
    expect(client.calls.filter((c) => c.op === 'update')).toHaveLength(0);
  });

  test('ops are applied one at a time, so concurrent ops from the page are not lost', async () => {
    const client = createMockClient(seed());
    const store = makeStore(client);
    await Promise.all([store.applyOp(PATH, vote('A', 1)), store.applyOp(PATH, vote('B', -1))]);
    expect(planIn(client).decisions[0].options[0].votes).toEqual({ A: 1, B: -1 });
    // Serialized, so neither op hit a conflict.
    expect(client.calls.filter((c) => c.op === 'update')).toHaveLength(2);
  });

  test('a failed op does not block the ones queued after it', async () => {
    const client = createMockClient(seed());
    const store = makeStore(client);
    const bad = store.applyOp(PATH, { type: 'explode', who: 'A' });
    const good = store.applyOp(PATH, vote('A', 1));
    await expect(bad).rejects.toThrow(/unknown op/i);
    await expect(good).resolves.toBeTruthy();
  });

  test('get returns an entry (null if missing); list returns entries under a prefix', async () => {
    const store = makeStore(createMockClient(seed()));
    expect(await store.get('trip.md')).toMatchObject({ path: 'trip.md', summary: 'Prose', content: '# Trip' });
    expect(await store.get('nope.md')).toBeNull();
    const list = await store.list('trip');
    expect(list.map((e) => e.path)).toEqual(['trip.md', PATH]);
    expect(list[0]).toEqual({ path: 'trip.md', topic: 't', summary: 'Prose' });
  });
});

describe('mock client', () => {
  test('bumps updated_at on every update, even within the same millisecond', async () => {
    const client = createMockClient(seed());
    const a = await client.from('brainy_knowledge').update({ content: 'a' }).eq('path', 'trip.md').select('updated_at');
    const b = await client.from('brainy_knowledge').update({ content: 'b' }).eq('path', 'trip.md').select('updated_at');
    expect(a.data[0].updated_at).not.toBe(b.data[0].updated_at);
  });

  test('an update that matches nothing returns no rows', async () => {
    const client = createMockClient(seed());
    const r = await client.from('brainy_knowledge').update({ content: 'a' }).eq('path', 'trip.md').eq('updated_at', 'stale').select('updated_at');
    expect(r).toEqual({ data: [], error: null });
  });
});
