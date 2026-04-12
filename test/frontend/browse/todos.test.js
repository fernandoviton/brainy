const fs = require('fs');
const path = require('path');
const vm = require('vm');

const flushPromises = () => new Promise(process.nextTick);

const appCode = fs.readFileSync(
  path.join(__dirname, '../../../frontend/browse/todos/app.js'),
  'utf8'
);

const utilsCode = fs.readFileSync(
  path.join(__dirname, '../../../frontend/utils.js'),
  'utf8'
);

function buildMockQuery(resolveData) {
  const mock = {
    _filters: {},
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    eq: jest.fn().mockImplementation(function (col, val) {
      mock._filters[col] = val;
      return mock;
    }),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation(function (cb) {
      cb({ data: resolveData || [], error: null });
      return Promise.resolve();
    }),
  };
  return mock;
}

function makeElement(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {},
    textContent: '',
    className: '',
    innerHTML: '',
    href: '',
    target: '',
    children: [],
    appendChild: jest.fn(function (child) {
      if (typeof child === 'string') {
        el.innerHTML += child.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      el.children.push(child);
    }),
    querySelectorAll: jest.fn(function (selector) {
      // Parse data-storage-path attributes from innerHTML for signed URL tests
      if (selector === '[data-storage-path]') {
        const matches = el.innerHTML.match(/data-storage-path="([^"]+)"/g) || [];
        return matches.map(m => {
          const pathVal = m.match(/data-storage-path="([^"]+)"/)[1];
          const mockEl = makeElement('span');
          mockEl.getAttribute = jest.fn((attr) => attr === 'data-storage-path' ? pathVal : null);
          mockEl.textContent = 'file';
          mockEl.parentNode = { replaceChild: jest.fn() };
          return mockEl;
        });
      }
      return [];
    }),
    querySelector: jest.fn(() => null),
    getAttribute: jest.fn(() => null),
    parentNode: null,
    replaceChild: jest.fn(),
    classList: {
      _classes: new Set(),
      contains: jest.fn(function (c) { return el.classList._classes.has(c); }),
      remove: jest.fn(function (c) { el.classList._classes.delete(c); }),
      add: jest.fn(function (c) { el.classList._classes.add(c); }),
      toggle: jest.fn(function (c) {
        if (el.classList._classes.has(c)) { el.classList._classes.delete(c); return false; }
        el.classList._classes.add(c);
        return true;
      }),
    },
  };
  return el;
}

function buildMockDOM() {
  const elements = {};
  const listeners = {};
  const createdElements = [];

  function makeEl(id) {
    const el = makeElement('div');
    el.addEventListener = jest.fn((event, handler) => {
      if (!listeners[`${id}:${event}`]) listeners[`${id}:${event}`] = [];
      listeners[`${id}:${event}`].push(handler);
    });
    elements[id] = el;
    return el;
  }

  makeEl('auth-section');
  makeEl('content-section');
  makeEl('login-btn');
  makeEl('logout-btn');
  makeEl('cards');
  makeEl('status-msg');
  makeEl('status-filter');
  makeEl('priority-filter');

  return {
    elements,
    listeners,
    createdElements,
    getElementById: jest.fn((id) => elements[id]),
    createElement: jest.fn((tag) => {
      const el = makeElement(tag);
      createdElements.push(el);
      return el;
    }),
    createTextNode: jest.fn((text) => text),
  };
}

/** Build a mock card element for expand/collapse tests */
function makeMockCard(idx, opts) {
  const expanded = opts && opts.expanded;
  const detailEl = opts && opts.detailEl;
  const card = makeElement('div');
  card.classList._classes = new Set(expanded ? ['card-expanded'] : []);
  card.getAttribute = jest.fn((attr) => attr === 'data-todo-idx' ? String(idx) : null);
  card.querySelector = jest.fn((sel) => {
    if (sel === '.card-detail') return detailEl || null;
    return null;
  });
  return card;
}

function makeMockToggle(card) {
  return {
    classList: { contains: jest.fn(() => true) },
    closest: jest.fn((sel) => sel === '.card' ? card : null),
  };
}

function loadApp(todos, collateralData, opts) {
  const mockQuery = buildMockQuery(todos);
  const collateralQuery = buildMockQuery(collateralData || []);
  // Detail query: returns full row with notes when expanding a card
  let detailQueryCallCount = 0;
  const makeDetailQuery = () => {
    const dq = buildMockQuery([]);
    const origEq = dq.eq;
    dq.eq = jest.fn(function (col, val) {
      origEq(col, val);
      // Return the matching todo from the sample data
      const match = (todos || []).filter(t => t[col] === val);
      dq.then = jest.fn(function (cb) {
        cb({ data: match, error: null });
        return Promise.resolve();
      });
      return dq;
    });
    return dq;
  };
  const mockFrom = jest.fn().mockImplementation(function (table) {
    if (table === 'brainy_todo_collateral') return collateralQuery;
    // After initial load, subsequent brainy_todos queries are detail fetches
    if (table === 'brainy_todos' && detailQueryCallCount++ > 0) return makeDetailQuery();
    return mockQuery;
  });
  const mockSignIn = jest.fn();
  const mockSignOut = jest.fn().mockResolvedValue({});
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: mockSignIn,
    signOut: mockSignOut,
  };
  const mockCreateSignedUrl = jest.fn().mockResolvedValue({ data: null });
  const mockCreateClient = jest.fn().mockReturnValue({
    auth: mockAuth,
    from: mockFrom,
    storage: { from: jest.fn().mockReturnValue({ createSignedUrl: mockCreateSignedUrl }) },
  });

  const dom = buildMockDOM();
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
    supabase: { createClient: mockCreateClient },
    document: dom,
    window: { location: { origin: 'https://example.com', pathname: '/browse/todos/' }, open: jest.fn() },
    console: { error: jest.fn(), log: jest.fn() },
    parseInt: parseInt,
  };

  // Add marked/DOMPurify unless explicitly excluded
  if (!opts || !opts.noMarkdown) {
    ctx.marked = { parse: jest.fn((text) => '<p>' + text + '</p>') };
    ctx.DOMPurify = { sanitize: jest.fn((html) => html) };
  }

  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(appCode, ctx);

  return {
    ctx, dom, mockAuth, mockFrom, mockQuery,
    collateralQuery, mockCreateSignedUrl, authCallback,
  };
}

const sampleTodos = [
  {
    id: 'uuid-1', name: 'fix-bug', status: 'active', priority: 'P1',
    summary: 'Fix the login bug', notes: 'Some **markdown** notes',
    category: 'dev', due: '2026-05-01', created_at: '2026-04-01T10:00:00Z',
  },
  {
    id: 'uuid-2', name: 'write-docs', status: 'inbox', priority: 'P2',
    summary: 'Write API docs', notes: null,
    category: null, due: null, created_at: '2026-04-02T10:00:00Z',
  },
];

/** Helper: sign in and expand card at given index, return the detail element */
async function signInAndExpand(env, cardIdx) {
  env.authCallback('SIGNED_IN', { user: { id: '123' } });
  await flushPromises();

  const clickHandlers = env.dom.listeners['cards:click'];
  const card = makeMockCard(cardIdx);
  const toggle = makeMockToggle(card);

  clickHandlers[0]({ target: toggle });
  await flushPromises();

  // The detail div is the element appended to the card
  const detailEl = card.appendChild.mock.calls.length > 0
    ? card.appendChild.mock.calls[0][0]
    : null;

  return { card, detailEl, clickHandlers };
}

// ── Step 1: Expand/collapse toggle + notes display ──────────────

describe('todo cards - expand/collapse', () => {
  test('initial load selects only summary columns, not *', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(env.mockQuery.select).toHaveBeenCalledWith(
      expect.not.stringContaining('*')
    );
    expect(env.mockQuery.select).toHaveBeenCalledWith(
      expect.not.stringContaining('notes')
    );
  });

  test('cards render with a toggle button (chevron)', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).toContain('card-toggle');
    expect(html).toContain('data-todo-idx=');
  });

  test('clicking toggle adds card-expanded class', async () => {
    const env = loadApp(sampleTodos);
    const { card } = await signInAndExpand(env, 0);
    expect(card.classList._classes.has('card-expanded')).toBe(true);
  });

  test('expanded card shows notes content', async () => {
    const env = loadApp(sampleTodos);
    const { detailEl } = await signInAndExpand(env, 0);
    expect(detailEl).not.toBeNull();
    expect(detailEl.innerHTML).toContain('card-notes');
  });

  test('clicking toggle again removes card-expanded class', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const clickHandlers = env.dom.listeners['cards:click'];
    const existingDetail = makeElement('div');
    const card = makeMockCard(0, { expanded: true, detailEl: existingDetail });
    const toggle = makeMockToggle(card);

    clickHandlers[0]({ target: toggle });
    await flushPromises();

    expect(card.classList._classes.has('card-expanded')).toBe(false);
  });

  test('card with no notes shows no notes section', async () => {
    const env = loadApp(sampleTodos);
    const { detailEl } = await signInAndExpand(env, 1); // write-docs has no notes
    expect(detailEl).not.toBeNull();
    expect(detailEl.innerHTML).not.toContain('card-notes');
  });

  test('uses due instead of due_date for due date display', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    // escapeHtml in the VM uses createElement which returns mock elements,
    // so the rendered HTML won't have escaped values — check the raw template output
    expect(html).toContain('Due ');
    expect(html).not.toContain('due_date');
  });
});

// ── Step 2: Markdown rendering ──────────────────────────────────

describe('todo cards - markdown rendering', () => {
  test('notes are rendered through marked.parse() and DOMPurify', async () => {
    const env = loadApp(sampleTodos);
    await signInAndExpand(env, 0);

    expect(env.ctx.marked.parse).toHaveBeenCalledWith('Some **markdown** notes');
    expect(env.ctx.DOMPurify.sanitize).toHaveBeenCalled();
  });

  test('fallback to escapeHtml when marked is unavailable', async () => {
    const env = loadApp(sampleTodos, [], { noMarkdown: true });
    const { detailEl } = await signInAndExpand(env, 0);

    expect(detailEl.innerHTML).toContain('card-notes');
    // Should not contain <p> tags from marked
    expect(detailEl.innerHTML).not.toContain('<p>');
  });
});

// ── Step 3: Fetch and display collateral ────────────────────────

describe('todo cards - collateral', () => {
  test('expanding a card triggers collateral query', async () => {
    const env = loadApp(sampleTodos);
    await signInAndExpand(env, 0);

    expect(env.mockFrom).toHaveBeenCalledWith('brainy_todo_collateral');
    expect(env.collateralQuery.eq).toHaveBeenCalledWith('todo_id', 'uuid-1');
  });

  test('text collateral renders inline', async () => {
    const collateral = [
      { id: 'c1', filename: 'notes.md', content_type: 'text/markdown', text_content: '# Hello', storage_path: null },
    ];
    const env = loadApp(sampleTodos, collateral);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(detailEl.innerHTML).toContain('card-collateral');
    expect(detailEl.innerHTML).toContain('notes.md');
  });

  test('binary collateral renders as placeholder with storage path', async () => {
    const collateral = [
      { id: 'c2', filename: 'report.pdf', content_type: 'application/pdf', text_content: null, storage_path: 'files/report.pdf' },
    ];
    const env = loadApp(sampleTodos, collateral);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(detailEl.innerHTML).toContain('report.pdf');
    expect(detailEl.innerHTML).toContain('data-storage-path');
  });

  test('collateral is cached — second expand does not re-query', async () => {
    const collateral = [
      { id: 'c1', filename: 'notes.md', content_type: 'text/markdown', text_content: '# Hello', storage_path: null },
    ];
    const env = loadApp(sampleTodos, collateral);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const clickHandlers = env.dom.listeners['cards:click'];

    // First expand
    const card1 = makeMockCard(0);
    clickHandlers[0]({ target: makeMockToggle(card1) });
    await flushPromises();
    const collateralCalls1 = env.mockFrom.mock.calls.filter(c => c[0] === 'brainy_todo_collateral').length;

    // Collapse
    const card2 = makeMockCard(0, { expanded: true, detailEl: makeElement('div') });
    clickHandlers[0]({ target: makeMockToggle(card2) });
    await flushPromises();

    // Second expand
    const card3 = makeMockCard(0);
    clickHandlers[0]({ target: makeMockToggle(card3) });
    await flushPromises();
    const collateralCalls2 = env.mockFrom.mock.calls.filter(c => c[0] === 'brainy_todo_collateral').length;

    expect(collateralCalls2).toBe(collateralCalls1);
  });

  test('.md files render as markdown even without markdown content_type', async () => {
    const collateral = [
      { id: 'c3', filename: 'readme.md', content_type: 'text/plain', text_content: '# Title', storage_path: null },
    ];
    const env = loadApp(sampleTodos, collateral);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(env.ctx.marked.parse).toHaveBeenCalledWith('# Title');
    expect(detailEl.innerHTML).not.toContain('<pre>');
  });

  test('.md files render as markdown when content_type is null', async () => {
    const collateral = [
      { id: 'c4', filename: 'notes.MD', content_type: null, text_content: '**bold**', storage_path: null },
    ];
    const env = loadApp(sampleTodos, collateral);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(env.ctx.marked.parse).toHaveBeenCalledWith('**bold**');
    expect(detailEl.innerHTML).not.toContain('<pre>');
  });

  test('non-md text collateral without markdown content_type renders as pre', async () => {
    const collateral = [
      { id: 'c5', filename: 'data.txt', content_type: 'text/plain', text_content: 'plain text', storage_path: null },
    ];
    const env = loadApp(sampleTodos, collateral);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(detailEl.innerHTML).toContain('<pre>');
  });

  test('card with no collateral shows no collateral section', async () => {
    const env = loadApp(sampleTodos, []);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(detailEl.innerHTML).not.toContain('card-collateral');
  });
});

// ── Step 4: Signed URLs for binary collateral ───────────────────

describe('todo cards - signed URLs', () => {
  test('binary collateral triggers createSignedUrl', async () => {
    const collateral = [
      { id: 'c2', filename: 'report.pdf', content_type: 'application/pdf', text_content: null, storage_path: 'files/report.pdf' },
    ];
    const env = loadApp(sampleTodos, collateral);
    env.mockCreateSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.url/report.pdf' } });
    await signInAndExpand(env, 0);

    expect(env.mockCreateSignedUrl).toHaveBeenCalledWith('files/report.pdf', 3600);
  });
});
