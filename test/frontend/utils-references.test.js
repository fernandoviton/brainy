/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../frontend/utils.js'),
  'utf8'
);

// utils.js is a plain browser script; evaluate it against jsdom's globals.
// eslint-disable-next-line no-new-func
const utils = new Function(utilsCode + '\nreturn { linkifyReferences, loadReferenceIndex, todoHref, knowledgeHref };')();

const index = {
  todos: { 'plan-italy-trip': true, 'book-colosseum-underground': true, 'recurring': true },
  knowledge: { 'travel/trips/italy-apr-2027.md': true, 'home/smoke-alarms.md': true },
};

function render(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  utils.linkifyReferences(el, index);
  return el;
}

function links(el) {
  return Array.from(el.querySelectorAll('a')).map((a) => [a.getAttribute('href'), a.textContent]);
}

describe('hrefs', () => {
  test('are relative to a browse page, so they survive a host move', () => {
    expect(utils.todoHref('plan-italy-trip')).toBe('../todos/#todo=plan-italy-trip');
    expect(utils.knowledgeHref('travel/trips/italy-apr-2027.md'))
      .toBe('../knowledge/#knowledge=travel/trips/italy-apr-2027.md');
  });
});

describe('linkifyReferences', () => {
  test('links a code span naming a known TODO', () => {
    const el = render('<p>see scheduled TODO <code>book-colosseum-underground</code></p>');
    expect(links(el)).toEqual([['../todos/#todo=book-colosseum-underground', 'book-colosseum-underground']]);
    // The code formatting is kept inside the link
    expect(el.querySelector('a > code')).not.toBeNull();
  });

  test('links a code span naming a known knowledge path', () => {
    const el = render('<p>record: knowledge <code>travel/trips/italy-apr-2027.md</code>.</p>');
    expect(links(el)).toEqual([['../knowledge/#knowledge=travel/trips/italy-apr-2027.md', 'travel/trips/italy-apr-2027.md']]);
  });

  test('links bare-text references to known names and paths', () => {
    const el = render('<p>Blocked by plan-italy-trip; see home/smoke-alarms.md. Done.</p>');
    expect(links(el)).toEqual([
      ['../todos/#todo=plan-italy-trip', 'plan-italy-trip'],
      ['../knowledge/#knowledge=home/smoke-alarms.md', 'home/smoke-alarms.md'],
    ]);
    expect(el.textContent).toBe('Blocked by plan-italy-trip; see home/smoke-alarms.md. Done.');
  });

  test('leaves unknown names, partial matches, and single-word bare text alone', () => {
    const el = render('<p><code>some-other-thing</code> plan-italy-trip-2 xplan-italy-trip ' +
      'a/home/smoke-alarms.md recurring</p>');
    expect(links(el)).toEqual([]);
  });

  test('a single-word TODO name still links from a code span', () => {
    const el = render('<p>see <code>recurring</code></p>');
    expect(links(el)).toEqual([['../todos/#todo=recurring', 'recurring']]);
  });

  test('does not touch existing links or code blocks, and is idempotent', () => {
    const el = render('<p><a href="https://x">plan-italy-trip</a></p><pre><code>plan-italy-trip</code></pre>');
    expect(links(el)).toEqual([['https://x', 'plan-italy-trip']]);
    utils.linkifyReferences(el, index);
    const once = render('<p>plan-italy-trip</p>');
    utils.linkifyReferences(once, index);
    expect(links(once)).toHaveLength(1);
  });

  test('a container without DOM traversal support is a no-op', () => {
    expect(() => utils.linkifyReferences({}, index)).not.toThrow();
    expect(() => utils.linkifyReferences(document.createElement('div'), null)).not.toThrow();
  });
});

describe('loadReferenceIndex', () => {
  function query(rows) {
    const q = {
      select: jest.fn(() => q),
      limit: jest.fn(() => q),
      then: (resolve) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return q;
  }

  test('indexes live and archived TODO names and knowledge paths, once per page', async () => {
    const tables = {
      brainy_todos: query([{ name: 'plan-italy-trip' }]),
      brainy_archive_entries: query([{ todo_name: 'old-task' }]),
      brainy_knowledge: query([{ path: 'home/smoke-alarms.md' }]),
    };
    const client = { from: jest.fn((t) => tables[t]) };
    const idx = await utils.loadReferenceIndex(client);
    expect(idx.todos).toEqual({ 'plan-italy-trip': true, 'old-task': true });
    expect(idx.knowledge).toEqual({ 'home/smoke-alarms.md': true });
    await utils.loadReferenceIndex(client);
    expect(client.from).toHaveBeenCalledTimes(3);
  });
});
