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
    _limit: null,
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    // Honour the row cap the way PostgREST does — the caller only ever sees
    // the first N rows, so a too-small limit silently hides real rows.
    limit: jest.fn().mockImplementation(function (n) {
      mock._limit = n;
      return mock;
    }),
    eq: jest.fn().mockImplementation(function (col, val) {
      mock._filters[col] = val;
      return mock;
    }),
    is: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    then: jest.fn().mockImplementation(function (cb) {
      let rows = resolveData || [];
      if (mock._limit !== null) rows = rows.slice(0, mock._limit);
      cb({ data: rows, error: null });
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
  const searchEl = makeEl('text-search');
  searchEl.value = '';

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
    window: {
      location: { origin: 'https://example.com', pathname: '/browse/todos/', hash: (opts && opts.hash) || '' },
      history: { replaceState: jest.fn() },
      open: jest.fn(),
    },
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

describe('browse todos - auth-event dedupe', () => {
  test('repeated auth events for same user do not re-fetch todos', async () => {
    const env = loadApp(sampleTodos);
    const session = { user: { id: 'user-1' } };

    env.authCallback('INITIAL_SESSION', session);
    await flushPromises();
    env.authCallback('SIGNED_IN', session);
    await flushPromises();
    env.authCallback('TOKEN_REFRESHED', session);
    await flushPromises();

    const todoCalls = env.mockFrom.mock.calls.filter((c) => c[0] === 'brainy_todos');
    expect(todoCalls).toHaveLength(1);
  });

  test('signing in as a different user does re-fetch', async () => {
    const env = loadApp(sampleTodos);

    env.authCallback('SIGNED_IN', { user: { id: 'user-1' } });
    await flushPromises();
    env.authCallback('SIGNED_OUT', null);
    await flushPromises();
    env.authCallback('SIGNED_IN', { user: { id: 'user-2' } });
    await flushPromises();

    const todoCalls = env.mockFrom.mock.calls.filter((c) => c[0] === 'brainy_todos');
    expect(todoCalls).toHaveLength(2);
  });
});

// ── Step 1: Expand/collapse toggle + notes display ──────────────

describe('browse todos - default filter', () => {
  test('initial load filters by status=active', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(env.mockQuery.eq).toHaveBeenCalledWith('status', 'active');
  });
});

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

// ── Scheduled date display ──────────────────────────────────────

describe('browse todos - scheduled date', () => {
  const scheduledTodos = [
    {
      id: 'uuid-s', name: 'vacuum-filter', status: 'scheduled', priority: 'P2',
      summary: 'Vacuum the prefilter', notes: null, category: 'home',
      due: null, scheduled_date: '2026-08-31', created_at: '2026-05-31T10:00:00Z',
    },
  ];

  test('initial load selects scheduled_date column', async () => {
    const env = loadApp(scheduledTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(env.mockQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('scheduled_date')
    );
  });

  test('scheduled todo renders its scheduled_date', async () => {
    const env = loadApp(scheduledTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).toContain('Scheduled ');
    expect(html).toContain('2026-08-31');
  });

  test('todo without scheduled_date shows no Scheduled label', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).not.toContain('Scheduled ');
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

  test('text collateral renders inline in a bordered box with filename header', async () => {
    const collateral = [
      { id: 'c1', filename: 'notes.md', content_type: 'text/markdown', text_content: '# Hello', storage_path: null },
    ];
    const env = loadApp(sampleTodos, collateral);
    const { detailEl } = await signInAndExpand(env, 0);

    expect(detailEl.innerHTML).toContain('card-collateral');
    expect(detailEl.innerHTML).toContain('collateral-box');
    expect(detailEl.innerHTML).toContain('collateral-box-header');
    expect(detailEl.innerHTML).toContain('collateral-toggle');
    expect(detailEl.innerHTML).toContain('notes.md');
    // No "COLLATERAL" label
    expect(detailEl.innerHTML).not.toContain('collateral-label');
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

// ── Step 5: Archived pill ───────────────────────────────────────

describe('browse todos - archived pill', () => {
  function loadAppWithArchive(archiveRows) {
    const liveQuery = buildMockQuery([]);
    const archiveQuery = buildMockQuery(archiveRows || []);
    const mockFrom = jest.fn().mockImplementation(function (table) {
      if (table === 'brainy_archive_entries') return archiveQuery;
      return liveQuery;
    });
    let authCallback;
    const mockAuth = {
      onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
      signInWithOAuth: jest.fn(),
      signOut: jest.fn().mockResolvedValue({}),
    };
    const mockCreateClient = jest.fn().mockReturnValue({
      auth: mockAuth, from: mockFrom,
      storage: { from: jest.fn().mockReturnValue({ createSignedUrl: jest.fn().mockResolvedValue({ data: null }) }) },
    });
    const dom = buildMockDOM();
    const ctx = {
      CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
      supabase: { createClient: mockCreateClient },
      document: dom,
      window: { location: { origin: 'https://example.com', pathname: '/browse/todos/' } },
      console: { error: jest.fn() },
      parseInt: parseInt,
      marked: { parse: jest.fn((t) => '<p>' + t + '</p>') },
      DOMPurify: { sanitize: jest.fn((h) => h) },
    };
    vm.createContext(ctx);
    vm.runInContext(utilsCode, ctx);
    vm.runInContext(appCode, ctx);
    return { ctx, dom, mockFrom, liveQuery, archiveQuery, authCallback };
  }

  function clickStatusPill(env, value) {
    const handler = env.dom.listeners['status-filter:click'][0];
    const pill = {
      classList: { contains: jest.fn(() => true), remove: jest.fn(), add: jest.fn() },
      getAttribute: jest.fn(() => value),
    };
    env.dom.elements['status-filter'].querySelectorAll = jest.fn(() => [pill]);
    handler({ target: pill });
  }

  test('clicking Archived pill queries brainy_archive_entries', async () => {
    const env = loadAppWithArchive([]);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    clickStatusPill(env, 'archived');
    await flushPromises();

    expect(env.mockFrom).toHaveBeenCalledWith('brainy_archive_entries');
  });

  test('archived rows render with archived status badge', async () => {
    const archiveRows = [{
      id: 'a1', todo_name: 'old-task', completion_date: '2026-04-01',
      year_month: '2026_04', summary_text: 'Done.',
      todo_snapshot: { priority: 'P1', category: 'dev' },
      collateral_snapshot: null,
    }];
    const env = loadAppWithArchive(archiveRows);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();
    clickStatusPill(env, 'archived');
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).toContain('badge-status-archived');
    expect(html).toContain('old-task');
  });

  test('archived snapshot collateral renders without re-querying brainy_todo_collateral', async () => {
    const archiveRows = [{
      id: 'a1', todo_name: 'old-task', completion_date: '2026-04-01',
      year_month: '2026_04', summary_text: 'Done.',
      todo_snapshot: { priority: 'P1' },
      collateral_snapshot: [
        { filename: 'note.md', content_type: 'text/markdown', text_content: '# hi', storage_path: null },
      ],
    }];
    const env = loadAppWithArchive(archiveRows);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();
    clickStatusPill(env, 'archived');
    await flushPromises();

    const beforeExpand = env.mockFrom.mock.calls.filter(c => c[0] === 'brainy_todo_collateral').length;

    const clickHandlers = env.dom.listeners['cards:click'];
    const card = makeMockCard(0);
    clickHandlers[0]({ target: makeMockToggle(card) });
    await flushPromises();

    const afterExpand = env.mockFrom.mock.calls.filter(c => c[0] === 'brainy_todo_collateral').length;
    expect(afterExpand).toBe(beforeExpand);

    const detailEl = card.appendChild.mock.calls[0][0];
    expect(detailEl.innerHTML).toContain('note.md');
  });
});

// ── Step 6: Live search ─────────────────────────────────────────

describe('browse todos - live search', () => {
  test('expanding a card after filtering loads the correct todo, not the one at the same index in the full list', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    // Filter so only the SECOND todo (write-docs, uuid-2) remains visible.
    // It now renders at filtered index 0.
    const searchEl = env.dom.elements['text-search'];
    searchEl.value = 'docs';
    env.dom.listeners['text-search:input'][0]();
    await flushPromises();

    // Expand the only visible card (index 0).
    const clickHandlers = env.dom.listeners['cards:click'];
    const card = makeMockCard(0);
    clickHandlers[0]({ target: makeMockToggle(card) });
    await flushPromises();

    // It must load write-docs's collateral (uuid-2), NOT fix-bug's (uuid-1).
    expect(env.collateralQuery.eq).toHaveBeenCalledWith('todo_id', 'uuid-2');
    expect(env.collateralQuery.eq).not.toHaveBeenCalledWith('todo_id', 'uuid-1');
  });

  test('typing in #text-search filters loaded cards without re-querying', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const beforeCount = env.mockFrom.mock.calls.filter(c => c[0] === 'brainy_todos').length;

    const searchEl = env.dom.elements['text-search'];
    searchEl.value = 'login';
    const handler = env.dom.listeners['text-search:input'][0];
    handler();
    await flushPromises();

    const afterCount = env.mockFrom.mock.calls.filter(c => c[0] === 'brainy_todos').length;
    expect(afterCount).toBe(beforeCount);

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).toContain('fix-bug');
    expect(html).not.toContain('write-docs');
  });
});

// ── Step 7: Deep linking ────────────────────────────────────────

describe('browse todos - deep linking', () => {
  test('hash #todo=<name> expands the matching card on load and scrolls to it', async () => {
    const env = loadApp(sampleTodos, [], { hash: '#todo=write-docs' });
    const card = makeMockCard(1);
    card.scrollIntoView = jest.fn();
    env.dom.elements['cards'].querySelector = jest.fn((sel) =>
      sel === '[data-todo-idx="1"]' ? card : null
    );

    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(card.classList._classes.has('card-expanded')).toBe(true);
    expect(env.collateralQuery.eq).toHaveBeenCalledWith('todo_id', 'uuid-2');
    expect(card.scrollIntoView).toHaveBeenCalled();
  });

  test('cards render with an anchor id matching the deep link hash', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const html = env.dom.elements['cards'].innerHTML;
    expect(html).toContain('id="todo=fix-bug"');
    expect(html).toContain('id="todo=write-docs"');
  });

  test('no hash: no card is auto-expanded on load', async () => {
    const env = loadApp(sampleTodos);
    const querySelector = jest.fn(() => null);
    env.dom.elements['cards'].querySelector = querySelector;

    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(querySelector).not.toHaveBeenCalled();
  });

  test('expanding a card writes #todo=<name> to the URL', async () => {
    const env = loadApp(sampleTodos);
    await signInAndExpand(env, 0);

    expect(env.ctx.window.history.replaceState).toHaveBeenCalledWith(null, '', '#todo=fix-bug');
  });

  test('collapsing a card clears the URL hash', async () => {
    const env = loadApp(sampleTodos);
    env.authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    const clickHandlers = env.dom.listeners['cards:click'];
    const card = makeMockCard(0, { expanded: true, detailEl: makeElement('div') });
    clickHandlers[0]({ target: makeMockToggle(card) });
    await flushPromises();

    expect(env.ctx.window.history.replaceState).toHaveBeenCalledWith(null, '', '/browse/todos/');
  });

  test('deep-linked todo missing from the loaded list is fetched by name and rendered', async () => {
    // Initial (status=active) load returns only fix-bug; the link targets write-docs.
    const initialQuery = buildMockQuery([sampleTodos[0]]);
    const suppQuery = buildMockQuery([sampleTodos[1]]);
    const collateralQuery = buildMockQuery([]);
    let todoCalls = 0;
    const mockFrom = jest.fn((table) => {
      if (table === 'brainy_todo_collateral') return collateralQuery;
      return todoCalls++ === 0 ? initialQuery : suppQuery;
    });
    let authCallback;
    const mockAuth = {
      onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
      signInWithOAuth: jest.fn(),
      signOut: jest.fn().mockResolvedValue({}),
    };
    const mockCreateClient = jest.fn().mockReturnValue({
      auth: mockAuth, from: mockFrom,
      storage: { from: jest.fn().mockReturnValue({ createSignedUrl: jest.fn().mockResolvedValue({ data: null }) }) },
    });
    const dom = buildMockDOM();
    const ctx = {
      CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
      supabase: { createClient: mockCreateClient },
      document: dom,
      window: {
        location: { origin: 'https://example.com', pathname: '/browse/todos/', hash: '#todo=write-docs' },
        history: { replaceState: jest.fn() },
      },
      console: { error: jest.fn() },
      parseInt: parseInt,
      marked: { parse: jest.fn((t) => '<p>' + t + '</p>') },
      DOMPurify: { sanitize: jest.fn((h) => h) },
    };
    vm.createContext(ctx);
    vm.runInContext(utilsCode, ctx);
    vm.runInContext(appCode, ctx);

    authCallback('SIGNED_IN', { user: { id: '123' } });
    await flushPromises();

    expect(suppQuery.eq).toHaveBeenCalledWith('name', 'write-docs');
    expect(dom.elements['cards'].innerHTML).toContain('write-docs');
  });
});

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

describe('logout', () => {
  test('signs out with local scope so the CLI session survives', () => {
    // Default scope is 'global', which revokes every refresh token for the
    // user — including the one the CLI stores in .env.
    const { dom, mockAuth } = loadApp([]);

    dom.listeners['logout-btn:click'][0]();

    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

// ── Step 8: Search covers the whole result set, All excludes archived, ──
//           and switching filters preserves the search box ──────────────

/**
 * Loader for filter-switching tests: every brainy_todos call gets a FRESH
 * query mock (loadApp's helper reuses one and treats later calls as detail
 * fetches, which breaks when a pill click re-runs loadTodos).
 */
function loadAppForFilters(liveRows, archiveRows, opts) {
  const liveQueries = [];
  const archiveQueries = [];
  const mockFrom = jest.fn(function (table) {
    if (table === 'brainy_archive_entries') {
      const q = buildMockQuery(archiveRows || []);
      archiveQueries.push(q);
      return q;
    }
    if (table === 'brainy_todo_collateral') return buildMockQuery([]);
    const q = buildMockQuery(liveRows || []);
    liveQueries.push(q);
    return q;
  });
  let authCallback;
  const mockAuth = {
    onAuthStateChange: jest.fn((cb) => { authCallback = cb; }),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn().mockResolvedValue({}),
  };
  const mockCreateClient = jest.fn().mockReturnValue({
    auth: mockAuth,
    from: mockFrom,
    storage: { from: jest.fn().mockReturnValue({ createSignedUrl: jest.fn().mockResolvedValue({ data: null }) }) },
  });
  const dom = buildMockDOM();
  const ctx = {
    CONFIG: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'test-key' },
    supabase: { createClient: mockCreateClient },
    document: dom,
    window: {
      location: { origin: 'https://example.com', pathname: '/browse/todos/', hash: (opts && opts.hash) || '' },
      history: { replaceState: jest.fn() },
    },
    console: { error: jest.fn() },
    parseInt: parseInt,
    marked: { parse: jest.fn((t) => '<p>' + t + '</p>') },
    DOMPurify: { sanitize: jest.fn((h) => h) },
  };
  vm.createContext(ctx);
  vm.runInContext(utilsCode, ctx);
  vm.runInContext(appCode, ctx);

  return {
    ctx, dom, mockFrom, liveQueries, archiveQueries, authCallback,
    lastLiveQuery: () => liveQueries[liveQueries.length - 1],
    signIn: async () => { authCallback('SIGNED_IN', { user: { id: '123' } }); await flushPromises(); },
    clickStatus: async (value) => {
      const handler = dom.listeners['status-filter:click'][0];
      const pill = {
        classList: { contains: jest.fn((c) => c === 'pill'), remove: jest.fn(), add: jest.fn() },
        getAttribute: jest.fn(() => value),
      };
      dom.elements['status-filter'].querySelectorAll = jest.fn(() => [pill]);
      handler({ target: pill });
      await flushPromises();
    },
    type: async (text) => {
      dom.elements['text-search'].value = text;
      dom.listeners['text-search:input'][0]();
      await flushPromises();
    },
    cardsHtml: () => dom.elements['cards'].innerHTML,
  };
}

/**
 * Build a realistic oversized store: `count` todos of mixed status, with the
 * search target LAST. The real row that exposed this bug
 * (margin-account-signing) has a NULL created_at, and Postgres sorts NULLs
 * last on a `created_at desc` order — so it sits at the very bottom of the
 * unfiltered result set and is the first row a row cap drops.
 */
function makeOversizedStore(count, targetName) {
  const statuses = ['active', 'inbox', 'later', 'scheduled'];
  const rows = [];
  for (let i = 0; i < count - 1; i++) {
    const status = statuses[i % statuses.length];
    rows.push({
      id: 'uuid-' + i,
      name: 'filler-todo-' + i,
      status: status,
      priority: 'P2',
      summary: 'Filler summary ' + i,
      category: 'misc',
      due: null,
      scheduled_date: status === 'scheduled' ? '2026-09-01' : null,
      created_at: '2026-0' + (1 + (i % 8)) + '-01T10:00:00Z',
    });
  }
  rows.push({
    id: 'uuid-target',
    name: targetName,
    status: 'active',
    priority: 'P2',
    summary: 'Get margin paperwork signed for the UTMA at the Bellevue branch',
    category: 'finance',
    due: null,
    scheduled_date: null,
    created_at: null,
  });
  return rows;
}

describe('browse todos - search reaches past the first page of rows', () => {
  // 58 live todos is the real store size that surfaced this.
  const store = makeOversizedStore(58, 'margin-account-signing');
  const activeOnly = store.filter((t) => t.status === 'active');

  test('REPRO: under All, a todo past row 50 is still findable by search', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();
    await env.clickStatus(''); // "All"

    await env.type('margin-account');

    expect(env.cardsHtml()).toContain('margin-account-signing');
  });

  test('the same search under Active finds it (why the bug looked filter-specific)', async () => {
    const env = loadAppForFilters(activeOnly);
    await env.signIn(); // default filter is already active

    await env.type('margin-account');

    expect(env.cardsHtml()).toContain('margin-account-signing');
  });

  test('the live query is not capped at 50 rows', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();

    expect(env.lastLiveQuery()._limit).toBeGreaterThanOrEqual(500);
  });

  test('a truncated result set says so instead of silently hiding rows', async () => {
    const env = loadAppForFilters(makeOversizedStore(600, 'margin-account-signing'));
    await env.signIn();

    expect(env.cardsHtml()).toContain('limit-warning');
  });

  test('an untruncated result set shows no limit note', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();

    expect(env.cardsHtml()).not.toContain('limit-warning');
  });

  test('the truncation notice leads with a warning emoji', async () => {
    const env = loadAppForFilters(makeOversizedStore(600, 'margin-account-signing'));
    await env.signIn();

    expect(env.cardsHtml()).toContain('⚠');
  });

  test('the truncation notice says outright that the list is incomplete', async () => {
    // While this is up the user cannot trust the list OR the search box, so
    // the wording has to say so rather than politely note a row count.
    const env = loadAppForFilters(makeOversizedStore(600, 'margin-account-signing'));
    await env.signIn();

    expect(env.cardsHtml().toLowerCase()).toContain('incomplete');
  });

  test('the archived view gets its own, much larger cap', async () => {
    // Archive is the one store that grows without bound — every completed
    // TODO lands there forever, while live statuses get archived off.
    const env = loadAppForFilters(store, []);
    await env.signIn();
    await env.clickStatus('archived');

    expect(env.archiveQueries[0]._limit).toBeGreaterThanOrEqual(5000);
  });

  test('the truncation notice is styled as a warning banner, not a footnote', () => {
    const shared = fs.readFileSync(
      path.join(__dirname, '../../../frontend/shared.css'),
      'utf8'
    );
    const rule = shared.slice(shared.indexOf('.limit-warning'));
    expect(rule).toContain('.limit-warning');
    expect(rule.slice(0, 400)).toMatch(/background/);
    expect(rule.slice(0, 400)).toMatch(/font-weight/);
  });
});

describe('browse todos - All excludes archived', () => {
  const store = makeOversizedStore(6, 'margin-account-signing');

  test('All queries only brainy_todos, never the archive table', async () => {
    const env = loadAppForFilters(store, [{
      id: 'a1', todo_name: 'old-task', completion_date: '2026-04-01',
      year_month: '2026_04', summary_text: 'Done.', todo_snapshot: {}, collateral_snapshot: null,
    }]);
    await env.signIn();
    await env.clickStatus('');

    expect(env.mockFrom).not.toHaveBeenCalledWith('brainy_archive_entries');
  });

  test('searching under All does not match an archived todo', async () => {
    const env = loadAppForFilters(store, [{
      id: 'a1', todo_name: 'archived-margin-thing', completion_date: '2026-04-01',
      year_month: '2026_04', summary_text: 'Done.', todo_snapshot: {}, collateral_snapshot: null,
    }]);
    await env.signIn();
    await env.clickStatus('');
    await env.type('margin');

    expect(env.cardsHtml()).toContain('margin-account-signing');
    expect(env.cardsHtml()).not.toContain('archived-margin-thing');
  });
});

describe('browse todos - status pill markup', () => {
  const indexHtml = fs.readFileSync(
    path.join(__dirname, '../../../frontend/browse/todos/index.html'),
    'utf8'
  );
  const groupStart = indexHtml.indexOf('id="status-filter"');
  const statusGroup = indexHtml.slice(groupStart, indexHtml.indexOf('</div>', groupStart));

  test('Archived is separated from the statuses All covers', () => {
    // The divider must sit between the last "All"-covered status and Archived,
    // so the row reads: All | Inbox Active Later Scheduled || Archived
    expect(statusGroup).toContain('pill-divider');
    expect(statusGroup.indexOf('pill-divider')).toBeGreaterThan(statusGroup.indexOf('data-value="scheduled"'));
    expect(statusGroup.indexOf('pill-divider')).toBeLessThan(statusGroup.indexOf('data-value="archived"'));
  });

  test('the divider is not itself clickable as a pill', () => {
    // setupFilterGroup dispatches on classList.contains('pill') and collects
    // pills with querySelectorAll('.pill'); a divider carrying that exact
    // class token would become a selectable, valueless filter.
    const tag = statusGroup.match(/<[^>]*pill-divider[^>]*>/)[0];
    const classes = tag.match(/class="([^"]*)"/)[1].split(/\s+/);
    expect(classes).toContain('pill-divider');
    expect(classes).not.toContain('pill');
  });

  test('the Archived pill explains that All does not include it', () => {
    const at = statusGroup.indexOf('data-value="archived"');
    const archivedPill = statusGroup.slice(at - 140, at + 200);
    expect(archivedPill).toContain('pill-archived');
    expect(archivedPill).toMatch(/title="[^"]+"/);
  });

  test('the divider is styled as a separator', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '../../../frontend/browse/todos/app.css'),
      'utf8'
    );
    expect(css).toContain('.pill-divider');
  });
});

describe('browse todos - switching filters keeps the search text', () => {
  const store = makeOversizedStore(58, 'margin-account-signing');

  test('switching status does not clear the search box', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();
    await env.type('margin-account');

    await env.clickStatus('');

    expect(env.dom.elements['text-search'].value).toBe('margin-account');
  });

  test('switching priority does not clear the search box', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();
    await env.type('margin-account');

    const handler = env.dom.listeners['priority-filter:click'][0];
    const pill = {
      classList: { contains: jest.fn((c) => c === 'pill'), remove: jest.fn(), add: jest.fn() },
      getAttribute: jest.fn(() => 'P2'),
    };
    env.dom.elements['priority-filter'].querySelectorAll = jest.fn(() => [pill]);
    handler({ target: pill });
    await flushPromises();

    expect(env.dom.elements['text-search'].value).toBe('margin-account');
  });

  test('the reloaded rows are re-filtered by the surviving search text', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();
    await env.type('margin-account');

    await env.clickStatus('');

    expect(env.cardsHtml()).toContain('margin-account-signing');
    expect(env.cardsHtml()).not.toContain('filler-todo-0');
  });

  test('switching to Archived re-applies the search text to archived rows', async () => {
    const env = loadAppForFilters(store, [
      {
        id: 'a1', todo_name: 'margin-paperwork-2025', completion_date: '2026-04-01',
        year_month: '2026_04', summary_text: 'Signed.', todo_snapshot: {}, collateral_snapshot: null,
      },
      {
        id: 'a2', todo_name: 'unrelated-old-task', completion_date: '2026-03-01',
        year_month: '2026_03', summary_text: 'Done.', todo_snapshot: {}, collateral_snapshot: null,
      },
    ]);
    await env.signIn();
    await env.type('margin');

    await env.clickStatus('archived');

    expect(env.cardsHtml()).toContain('margin-paperwork-2025');
    expect(env.cardsHtml()).not.toContain('unrelated-old-task');
  });

  test('an empty search box after a filter switch renders everything loaded', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();

    await env.clickStatus('');

    expect(env.cardsHtml()).toContain('filler-todo-0');
    expect(env.cardsHtml()).toContain('margin-account-signing');
  });

  test('clearing the search box after a filter switch restores the full list', async () => {
    const env = loadAppForFilters(store);
    await env.signIn();
    await env.type('margin-account');
    await env.clickStatus('');

    await env.type('');

    expect(env.cardsHtml()).toContain('filler-todo-0');
  });
});
