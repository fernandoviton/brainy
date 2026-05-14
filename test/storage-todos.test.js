const mockSupabase = require('./helpers/mock-supabase');

jest.mock('../backend/supabase-client', () => mockSupabase);

const storage = require('../backend/storage-supabase');

beforeEach(() => {
  jest.clearAllMocks();
  mockSupabase.resetMock();
});

describe('archiveTodo - collateral snapshot', () => {
  test('snapshot preserves full collateral rows (filename, content_type, storage_path, text_content)', async () => {
    const todoRow = {
      id: 'todo-1', user_id: 'u', name: 'finish-X', status: 'active',
      priority: 'P1', summary: 's', notes: 'n', category: 'c', due: null,
    };
    const collateralRows = [
      { filename: 'note.md', content_type: 'text/markdown', storage_path: null, text_content: '# hi' },
      { filename: 'report.pdf', content_type: 'application/pdf', storage_path: 'path/report.pdf', text_content: null },
    ];

    const archiveInsertChain = {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
    };
    archiveInsertChain.then = function (resolve) { return resolve({ data: null, error: null }); };

    let callIdx = 0;
    mockSupabase.supabase.from.mockImplementation((table) => {
      callIdx++;
      // Call 1: fetch todo (.single)
      if (callIdx === 1) {
        const c = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: todoRow, error: null })),
        };
        return c;
      }
      // Call 2: fetch collateral (thenable)
      if (callIdx === 2) {
        const c = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        };
        c.then = function (resolve) { return resolve({ data: collateralRows, error: null }); };
        return c;
      }
      // Call 3: insert into brainy_archive_entries
      if (callIdx === 3) {
        return archiveInsertChain;
      }
      // Call 4: fetch existing summary (.single returns null)
      if (callIdx === 4) {
        const c = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: null, error: null })),
        };
        return c;
      }
      // Call 5+: insert/update summary, delete todo — generic chain
      const c = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };
      c.then = function (resolve) { return resolve({ data: null, error: null }); };
      return c;
    });

    await storage.archiveTodo('finish-X', { summaryText: 'done', completionDate: '2026-05-01' });

    const insertCalls = archiveInsertChain.insert.mock.calls;
    expect(insertCalls.length).toBe(1);
    const inserted = insertCalls[0][0];
    expect(inserted.collateral_snapshot).toEqual([
      { filename: 'note.md', content_type: 'text/markdown', storage_path: null, text_content: '# hi' },
      { filename: 'report.pdf', content_type: 'application/pdf', storage_path: 'path/report.pdf', text_content: null },
    ]);
  });
});
