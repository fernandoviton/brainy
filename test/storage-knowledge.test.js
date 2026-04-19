const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
});

describe('upsertKnowledge', () => {
  test('writes summary when provided', async () => {
    mockSupabase.setMockResult(null);
    await storage.upsertKnowledge({
      path: 'home/filter-inventory.md',
      content: '# filters',
      topic: 'filter inventory',
      summary: 'HVAC filter sizes by room',
    });

    const chain = mockSupabase.supabase.from.mock.results[0].value;
    const row = chain.upsert.mock.calls[0][0];
    expect(row.summary).toBe('HVAC filter sizes by room');
    expect(row.topic).toBe('filter inventory');
    expect(row.content).toBe('# filters');
    expect(row.path).toBe('home/filter-inventory.md');
    expect(row).not.toHaveProperty('format');
  });

  test('writes summary: null when not provided', async () => {
    mockSupabase.setMockResult(null);
    await storage.upsertKnowledge({
      path: 'notes.md',
      content: 'body',
    });

    const chain = mockSupabase.supabase.from.mock.results[0].value;
    const row = chain.upsert.mock.calls[0][0];
    expect(row.summary).toBeNull();
  });
});

describe('listKnowledge', () => {
  test('returns summary in each row, defaulting empty string; no format', async () => {
    mockSupabase.setMockResult([
      { path: 'a.md', topic: 'A', summary: 'summary a' },
      { path: 'b.md', topic: 'B', summary: null },
    ]);

    const result = await storage.listKnowledge();

    expect(result).toEqual([
      { path: 'a.md', topic: 'A', summary: 'summary a' },
      { path: 'b.md', topic: 'B', summary: '' },
    ]);
    expect(result[0]).not.toHaveProperty('format');

    const chain = mockSupabase.supabase.from.mock.results[0].value;
    expect(chain.select).toHaveBeenCalled();
    expect(chain.select.mock.calls[0][0]).toContain('summary');
    expect(chain.select.mock.calls[0][0]).not.toContain('format');
  });
});

describe('getKnowledge', () => {
  test('returns summary in shape, no format key', async () => {
    mockSupabase.setMockResult({
      path: 'a.md', topic: 'A', content: 'body', summary: 'top-line',
    });

    const result = await storage.getKnowledge('a.md');
    expect(result.summary).toBe('top-line');
    expect(result).not.toHaveProperty('format');
  });

  test('returns summary: "" when DB value is null', async () => {
    mockSupabase.setMockResult({
      path: 'a.md', topic: 'A', content: 'body', summary: null,
    });

    const result = await storage.getKnowledge('a.md');
    expect(result.summary).toBe('');
  });
});
