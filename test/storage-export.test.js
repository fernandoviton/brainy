const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
});

// Build a thenable query chain that resolves to `rows` regardless of which
// filter/select methods are chained onto it.
function chainReturning(rows) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('exportAll', () => {
  test('returns rows from every brainy_* table keyed by resource', async () => {
    const byTable = {
      brainy_todos: [{ id: 't1', name: 'build-x', notes: 'hi' }],
      brainy_todo_collateral: [{ todo_id: 't1', filename: 'a.txt', text_content: 'x' }],
      brainy_knowledge: [{ path: 'a.md', content: 'body' }],
      brainy_knowledge_attachments: [{ path: 'a.md', filename: 'img.png', storage_path: 'u/a/img.png' }],
      brainy_archive_entries: [{ id: 'e1', todo_name: 'old', year_month: '2026_01' }],
      brainy_archive_summaries: [{ year_month: '2026_01', content: '# Archive' }],
      brainy_captures: [{ id: 'c1', text: 'note' }],
      brainy_capture_media: [{ capture_id: 'c1', filename: 'p.png', storage_path: 'u/c/p.png' }],
    };

    mockSupabase.supabase.from.mockImplementation((table) =>
      chainReturning(byTable[table] || [])
    );

    const result = await storage.exportAll();

    expect(result.todos).toEqual(byTable.brainy_todos);
    expect(result.collateral).toEqual(byTable.brainy_todo_collateral);
    expect(result.knowledge).toEqual(byTable.brainy_knowledge);
    expect(result.knowledgeAttachments).toEqual(byTable.brainy_knowledge_attachments);
    expect(result.archiveEntries).toEqual(byTable.brainy_archive_entries);
    expect(result.archiveSummaries).toEqual(byTable.brainy_archive_summaries);
    expect(result.captures).toEqual(byTable.brainy_captures);
    expect(result.captureMedia).toEqual(byTable.brainy_capture_media);
  });

  test('scopes every query to the authenticated user', async () => {
    const chains = [];
    mockSupabase.supabase.from.mockImplementation(() => {
      const chain = chainReturning([]);
      chains.push(chain);
      return chain;
    });

    await storage.exportAll();

    expect(chains.length).toBeGreaterThan(0);
    for (const chain of chains) {
      expect(chain.eq).toHaveBeenCalledWith('user_id', 'test-user-id');
    }
  });
});
