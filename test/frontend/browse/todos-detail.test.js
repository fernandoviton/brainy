// Pure helpers behind the TODO detail drawer (frontend/browse/todos/detail.js):
// archive rows, archived collateral snapshots, and collateral markup.
const D = require('../../../frontend/browse/todos/detail');

const md = (text) => '<md>' + text + '</md>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

describe('archiveRowToTodo', () => {
  test('maps an archive entry to a TODO-shaped row', () => {
    const t = D.archiveRowToTodo({
      id: 'a1', todo_name: 'old-task', completion_date: '2030-02-01', summary_text: 'Done it.\n\nMore detail.',
      todo_snapshot: { priority: 'P1', category: 'home' }, collateral_snapshot: [{ filename: 'x.md' }],
    });
    expect(t).toEqual({
      id: 'a1', name: 'old-task', status: 'archived', priority: 'P1', category: 'home',
      summary: 'Done it.', notes: 'Done it.\n\nMore detail.', completion_date: '2030-02-01',
      archived: true, collateralSnapshot: [{ filename: 'x.md' }],
    });
  });
  test('copes with missing snapshots', () => {
    const t = D.archiveRowToTodo({ id: 'a2', todo_name: 'bare', completion_date: '2030-01-01' });
    expect(t.priority).toBeNull();
    expect(t.summary).toBe('');
    expect(t.collateralSnapshot).toBeNull();
  });
});

describe('normalizeArchivedCollateral', () => {
  test('old filename-only entries become legacy items; objects pass through', () => {
    expect(D.normalizeArchivedCollateral(null)).toEqual([]);
    expect(D.normalizeArchivedCollateral(['a.pdf', { filename: 'b.md', text_content: 'hi' }])).toEqual([
      { filename: 'a.pdf', content_type: null, storage_path: null, text_content: null, legacy: true },
      { filename: 'b.md', text_content: 'hi' },
    ]);
  });
});

describe('collateralHtml', () => {
  const html = (items) => D.collateralHtml(items, md, esc);

  test('no items, no markup', () => {
    expect(html([])).toBe('');
    expect(html(null)).toBe('');
  });
  test('markdown text (by content type or .md name) is rendered as markdown in a collapsible box', () => {
    const out = html([
      { filename: 'notes.md', content_type: null, text_content: '# Hi' },
      { filename: 'plan.txt', content_type: 'text/markdown', text_content: 'x' },
    ]);
    expect(out).toContain('class="collateral-box"');
    expect(out).toContain('collateral-toggle');
    expect(out).toContain('<md># Hi</md>');
    expect(out).toContain('<md>x</md>');
  });
  test('other text is shown preformatted and escaped', () => {
    expect(html([{ filename: 'log.txt', content_type: 'text/plain', text_content: '<b>' }])).toContain('<pre>&lt;b&gt;</pre>');
  });
  test('binary files become a placeholder resolved to a link later', () => {
    const out = html([{ filename: 'scan.pdf', content_type: 'application/pdf', storage_path: 'todos/1/scan.pdf' }]);
    expect(out).toContain('class="collateral-file-link" data-storage-path="todos/1/scan.pdf" data-content-type="application/pdf"');
    expect(out).toContain('scan.pdf');
  });
  test('legacy archive entries say their content was not preserved', () => {
    expect(html([{ filename: 'old.pdf', legacy: true }])).toContain('(content not preserved)');
  });
});
