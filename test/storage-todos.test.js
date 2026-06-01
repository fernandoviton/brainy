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

// A todo carries a scheduled_date iff its status is 'scheduled'; `due` is always optional.
describe('createTodo - schedule invariant', () => {
  test('rejects status=scheduled without a scheduled_date', async () => {
    await expect(storage.createTodo({ name: 'a', status: 'scheduled' }))
      .rejects.toThrow(/scheduled_date/);
  });

  test('rejects a scheduled_date when status is not scheduled', async () => {
    await expect(storage.createTodo({ name: 'a', status: 'active', scheduled_date: '2026-08-31' }))
      .rejects.toThrow(/scheduled/);
  });

  test('rejects a scheduled_date when status defaults to inbox', async () => {
    await expect(storage.createTodo({ name: 'a', scheduled_date: '2026-08-31' }))
      .rejects.toThrow(/scheduled/);
  });

  test('allows status=scheduled with a scheduled_date', async () => {
    const res = await storage.createTodo({ name: 'a', status: 'scheduled', scheduled_date: '2026-08-31' });
    expect(res.status).toBe('scheduled');
  });
});

describe('updateTodo - schedule invariant', () => {
  test('rejects moving to scheduled with no scheduled_date provided or existing', async () => {
    mockSupabase.setMockSingle({ status: 'active', scheduled_date: null });
    await expect(storage.updateTodo('t', { status: 'scheduled' }))
      .rejects.toThrow(/scheduled_date/);
  });

  test('rejects setting a scheduled_date on a todo that stays non-scheduled', async () => {
    mockSupabase.setMockSingle({ status: 'active', scheduled_date: null });
    await expect(storage.updateTodo('t', { scheduled_date: '2026-08-31' }))
      .rejects.toThrow(/scheduled/);
  });

  test('allows moving to scheduled when a scheduled_date is provided', async () => {
    mockSupabase.setMockSingle({ name: 't', status: 'scheduled', scheduled_date: '2026-08-31' });
    const res = await storage.updateTodo('t', { status: 'scheduled', scheduled_date: '2026-08-31' });
    expect(res.status).toBe('scheduled');
  });

  test('clears the scheduled_date when moving off scheduled', async () => {
    const payloads = [];
    let call = 0;
    mockSupabase.supabase.from.mockImplementation(() => {
      call++;
      if (call === 1) {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn(() => Promise.resolve({ data: { status: 'scheduled', scheduled_date: '2026-08-31' }, error: null })),
        };
      }
      const c = {
        update: jest.fn((p) => { payloads.push(p); return c; }),
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: { name: 't', status: 'active' }, error: null })),
      };
      return c;
    });

    await storage.updateTodo('t', { status: 'active' });
    expect(payloads[0]).toHaveProperty('scheduled_date', null);
  });

  test('skips validation when neither status nor scheduled_date changes', async () => {
    mockSupabase.setMockSingle({ name: 't', status: 'scheduled' });
    const res = await storage.updateTodo('t', { priority: 'P1' });
    expect(res.name).toBe('t');
  });
});

describe('promoteScheduled - clears scheduled_date', () => {
  test('promotes due todos to active and nulls their scheduled_date', async () => {
    const payloads = [];
    let call = 0;
    mockSupabase.supabase.from.mockImplementation(() => {
      call++;
      if (call === 1) {
        const c = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), lte: jest.fn().mockReturnThis() };
        c.then = (resolve) => resolve({ data: [{ id: '1', name: 'x' }], error: null });
        return c;
      }
      const c = { update: jest.fn((p) => { payloads.push(p); return c; }), in: jest.fn().mockReturnThis() };
      c.then = (resolve) => resolve({ data: null, error: null });
      return c;
    });

    const names = await storage.promoteScheduled();
    expect(names).toEqual(['x']);
    expect(payloads[0]).toHaveProperty('scheduled_date', null);
  });
});
