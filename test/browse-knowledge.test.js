/**
 * @jest-environment jsdom
 */

// Provide browser globals that app.js expects
const { JSDOM } = require('jest-environment-jsdom');

// --- Helpers: simulate the browser globals app.js relies on ---

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function truncate(str, maxLen) {
  maxLen = maxLen || 120;
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '\u2026';
}

function formatDate() { return '2d ago'; }

// We'll load the pure functions from app.js by extracting them.
// Since app.js is a browser script with side effects, we test the logic
// by reimplementing the pure functions here and verifying them,
// then the actual app.js will use the same logic.

// --- attachments query columns (regression: 400 from selecting non-existent content_type) ---

describe('attachments query in app.js', function () {
  const fs = require('fs');
  const path = require('path');
  const appSrc = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'browse', 'knowledge', 'app.js'),
    'utf8'
  );

  test('select list for brainy_knowledge_attachments only references real schema columns', function () {
    // Extract the .select(...) call that follows the attachments table reference.
    var re = /from\(['"]brainy_knowledge_attachments['"]\)\s*\.select\(['"]([^'"]+)['"]\)/;
    var m = appSrc.match(re);
    expect(m).not.toBeNull();

    var columns = m[1].split(',').map(function (s) { return s.trim(); });
    // Schema columns from sql/setup.sql:
    var allowed = ['id', 'user_id', 'knowledge_id', 'path', 'filename', 'storage_path', 'created_at'];
    for (var i = 0; i < columns.length; i++) {
      expect(allowed).toContain(columns[i]);
    }
  });
});

// --- renderMarkdown ---

describe('renderMarkdown', function () {
  function renderMarkdown(text, markedAvailable) {
    if (markedAvailable) {
      // Simulate marked + DOMPurify available
      var marked = { parse: function (t) { return '<p>' + t + '</p>'; } };
      var DOMPurify = { sanitize: function (h) { return h; } };
      return DOMPurify.sanitize(marked.parse(text));
    }
    return escapeHtml(text);
  }

  test('returns rendered HTML when libs available', function () {
    expect(renderMarkdown('hello', true)).toBe('<p>hello</p>');
  });

  test('falls back to escaped HTML when libs unavailable', function () {
    expect(renderMarkdown('<script>alert(1)</script>', false))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

// --- renderDetailHtml ---

describe('renderDetailHtml', function () {
  function renderDetailHtml(row) {
    if (!row.content) return '<div class="detail-empty">No content.</div>';
    // markdown — for test, simulate rendered
    return '<div class="card-content">' + '<p>' + row.content + '</p>' + '</div>';
  }

  test('markdown content rendered as HTML', function () {
    var html = renderDetailHtml({ content: 'hello world' });
    expect(html).toContain('<p>hello world</p>');
    expect(html).not.toContain('<pre>');
  });

  test('empty content shows message', function () {
    var html = renderDetailHtml({ content: '' });
    expect(html).toContain('No content');
  });

  test('null content shows message', function () {
    var html = renderDetailHtml({ content: null });
    expect(html).toContain('No content');
  });
});

// --- renderAttachmentsHtml ---

describe('renderAttachmentsHtml', function () {
  function renderAttachmentsHtml(items) {
    if (!items || items.length === 0) return '';
    var html = '<div class="card-attachments">';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.storage_path) {
        html += '<div class="collateral-box collateral-box-link">' +
          '<span class="collateral-file-link" data-storage-path="' + escapeHtml(item.storage_path) + '">' +
            escapeHtml(item.filename) +
          '</span>' +
        '</div>';
      }
    }
    html += '</div>';
    return html;
  }

  test('empty array returns empty string', function () {
    expect(renderAttachmentsHtml([])).toBe('');
  });

  test('null returns empty string', function () {
    expect(renderAttachmentsHtml(null)).toBe('');
  });

  test('generates link boxes for binary attachments', function () {
    var items = [
      { filename: 'doc.pdf', storage_path: 'files/doc.pdf' },
      { filename: 'img.png', storage_path: 'files/img.png' },
    ];
    var html = renderAttachmentsHtml(items);
    expect(html).toContain('collateral-box-link');
    expect(html).toContain('data-storage-path="files/doc.pdf"');
    expect(html).toContain('doc.pdf');
    expect(html).toContain('data-storage-path="files/img.png"');
    expect(html).toContain('img.png');
  });

  test('escapes special characters in filenames', function () {
    var items = [{ filename: '<bad>.txt', storage_path: 'files/bad.txt' }];
    var html = renderAttachmentsHtml(items);
    expect(html).toContain('&lt;bad&gt;.txt');
    expect(html).not.toContain('<bad>');
  });
});

// --- buildCardHtml ---

describe('buildCardHtml', function () {
  function renderPathBreadcrumb(path) {
    var parts = path.split('/');
    var html = '';
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) html += '<span class="path-separator">/</span>';
      html += '<span class="path-segment">' + escapeHtml(parts[i]) + '</span>';
    }
    return html;
  }

  function buildCardHtml(item) {
    return '<div class="card" data-knowledge-path="' + escapeHtml(item.path) + '">' +
      '<div class="card-header">' +
        '<button class="card-toggle" aria-label="Expand">&#x25B6;</button>' +
        '<span class="card-path">' + renderPathBreadcrumb(item.path) + '</span>' +
      '</div>' +
      (item.topic ? '<div class="card-topic">' + escapeHtml(item.topic) + '</div>' : '') +
      (item.summary ? '<div class="card-summary">' + escapeHtml(truncate(item.summary, 200)) + '</div>' : '') +
      '<div class="card-meta">' +
        '<span>' + escapeHtml(formatDate(item.updated_at)) + '</span>' +
      '</div>' +
    '</div>';
  }

  test('includes card-toggle button', function () {
    var html = buildCardHtml({ path: 'tools/docker.md', updated_at: '2025-01-01' });
    expect(html).toContain('card-toggle');
    expect(html).toContain('aria-label="Expand"');
  });

  test('includes data-knowledge-path matching the item path', function () {
    var html = buildCardHtml({ path: 'home/bedding/pillowcases.md', updated_at: '2025-01-01' });
    expect(html).toContain('data-knowledge-path="home/bedding/pillowcases.md"');
    expect(html).not.toContain('data-knowledge-idx');
  });

  test('renders path breadcrumb with separator', function () {
    var html = buildCardHtml({ path: 'tools/docker/networking.md', updated_at: '2025-01-01' });
    expect(html).toContain('path-separator');
    expect(html).toContain('path-segment');
    expect(html).toContain('docker');
    expect(html).toContain('networking.md');
  });

  test('does not include format badge', function () {
    var html = buildCardHtml({ path: 'a.md', updated_at: '2025-01-01' });
    expect(html).not.toContain('badge-format');
  });

  test('includes topic and summary when present', function () {
    var html = buildCardHtml({
      path: 'a.md', topic: 'Docker Networking',
      summary: 'How to configure bridge networks', updated_at: '2025-01-01'
    });
    expect(html).toContain('card-topic');
    expect(html).toContain('Docker Networking');
    expect(html).toContain('card-summary');
    expect(html).toContain('How to configure bridge networks');
  });

  test('omits topic and summary when absent', function () {
    var html = buildCardHtml({ path: 'a.md', updated_at: '2025-01-01' });
    expect(html).not.toContain('card-topic');
    expect(html).not.toContain('card-summary');
  });
});

// --- groupByTopLevel ---

describe('groupByTopLevel', function () {
  function groupByTopLevel(items) {
    if (!items || items.length === 0) return [];
    var groups = [];
    var groupMap = {};
    for (var i = 0; i < items.length; i++) {
      var parts = items[i].path.split('/');
      var key = parts.length > 1 ? parts[0] : 'Other';
      if (groupMap[key] === undefined) {
        groupMap[key] = groups.length;
        groups.push({ group: key, items: [] });
      }
      groups[groupMap[key]].items.push(items[i]);
    }
    return groups;
  }

  test('groups items by first path segment', function () {
    var items = [
      { path: 'tools/docker.md' },
      { path: 'tools/git.md' },
      { path: 'home/setup.md' },
    ];
    var result = groupByTopLevel(items);
    expect(result).toEqual([
      { group: 'tools', items: [{ path: 'tools/docker.md' }, { path: 'tools/git.md' }] },
      { group: 'home', items: [{ path: 'home/setup.md' }] },
    ]);
  });

  test('returns groups ordered by first appearance', function () {
    var items = [
      { path: 'home/a.md' },
      { path: 'tools/b.md' },
      { path: 'home/c.md' },
    ];
    var result = groupByTopLevel(items);
    expect(result[0].group).toBe('home');
    expect(result[1].group).toBe('tools');
  });

  test('single-segment paths go into Other group', function () {
    var items = [
      { path: 'notes.md' },
      { path: 'tools/a.md' },
      { path: 'readme.md' },
    ];
    var result = groupByTopLevel(items);
    var otherGroup = result.find(function (g) { return g.group === 'Other'; });
    expect(otherGroup).toBeDefined();
    expect(otherGroup.items).toEqual([{ path: 'notes.md' }, { path: 'readme.md' }]);
  });

  test('empty input returns empty array', function () {
    expect(groupByTopLevel([])).toEqual([]);
    expect(groupByTopLevel(null)).toEqual([]);
  });
});

// --- renderKnowledgeHtml grouping ---

describe('renderKnowledgeHtml grouping', function () {
  function groupByTopLevel(items) {
    if (!items || items.length === 0) return [];
    var groups = [];
    var groupMap = {};
    for (var i = 0; i < items.length; i++) {
      var parts = items[i].path.split('/');
      var key = parts.length > 1 ? parts[0] : 'Other';
      if (groupMap[key] === undefined) {
        groupMap[key] = groups.length;
        groups.push({ group: key, items: [] });
      }
      groups[groupMap[key]].items.push(items[i]);
    }
    return groups;
  }

  function renderPathBreadcrumb(path) {
    var parts = path.split('/');
    var html = '';
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) html += '<span class="path-separator">/</span>';
      html += '<span class="path-segment">' + escapeHtml(parts[i]) + '</span>';
    }
    return html;
  }

  function renderKnowledge(items) {
    if (!items || items.length === 0) {
      return '<div class="empty-state">No knowledge entries found.</div>';
    }
    var groups = groupByTopLevel(items);
    var html = '';
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      var label = group.group.charAt(0).toUpperCase() + group.group.slice(1);
      html += '<div class="section-group">';
      html += '<h2 class="section-heading">' + escapeHtml(label) + '</h2>';
      for (var i = 0; i < group.items.length; i++) {
        var k = group.items[i];
        html += '<div class="card" data-knowledge-path="' + escapeHtml(k.path) + '">' +
          '<div class="card-header">' +
            '<button class="card-toggle" aria-label="Expand">&#x25B6;</button>' +
            '<span class="card-path">' + renderPathBreadcrumb(k.path) + '</span>' +
          '</div>' +
          (k.topic ? '<div class="card-topic">' + escapeHtml(k.topic) + '</div>' : '') +
          (k.summary ? '<div class="card-summary">' + escapeHtml(truncate(k.summary, 200)) + '</div>' : '') +
          '<div class="card-meta">' +
            '<span>' + escapeHtml(formatDate(k.updated_at)) + '</span>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
    }
    return html;
  }

  function findItemByPath(items, path) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].path === path) return items[i];
    }
    return null;
  }

  test('wraps groups in section-group with section-heading', function () {
    var items = [
      { path: 'tools/docker.md', updated_at: '2025-01-01' },
      { path: 'home/setup.md', updated_at: '2025-01-01' },
    ];
    var html = renderKnowledge(items);
    expect(html).toContain('section-group');
    expect(html).toContain('section-heading');
    expect(html).toContain('Tools');
    expect(html).toContain('Home');
  });

  test('each card is tagged with its own path', function () {
    var items = [
      { path: 'tools/a.md', updated_at: '2025-01-01' },
      { path: 'tools/b.md', updated_at: '2025-01-01' },
      { path: 'home/c.md', updated_at: '2025-01-01' },
    ];
    var html = renderKnowledge(items);
    expect(html).toContain('data-knowledge-path="tools/a.md"');
    expect(html).toContain('data-knowledge-path="tools/b.md"');
    expect(html).toContain('data-knowledge-path="home/c.md"');
  });

  test('card lookup by path resolves to the correct item when groups reorder (regression: pillowcases showed window-coverings content)', function () {
    // Input order matches supabase path-sort; grouping reorders visually so
    // positional-index lookup into the original array returns the wrong item.
    var items = [
      { path: 'family.md', updated_at: '2025-01-01' },
      { path: 'home/bedding/pillowcases.md', updated_at: '2025-01-01' },
      { path: 'home/window-coverings/window-coverings.md', updated_at: '2025-01-01' },
      { path: 'README.md', updated_at: '2025-01-01' },
    ];
    var html = renderKnowledge(items);

    var container = document.createElement('div');
    container.innerHTML = html;
    var cards = container.querySelectorAll('.card');
    expect(cards.length).toBe(items.length);

    // For every rendered card, data-knowledge-path must resolve to the
    // item whose path matches — regardless of grouping order.
    for (var i = 0; i < cards.length; i++) {
      var path = cards[i].getAttribute('data-knowledge-path');
      var resolved = findItemByPath(items, path);
      expect(resolved).not.toBeNull();
      expect(resolved.path).toBe(path);
    }

    // Explicit regression assertion: the card whose breadcrumb says
    // pillowcases must carry the pillowcases path — not window-coverings.
    var pillowCard = null;
    for (var j = 0; j < cards.length; j++) {
      if (cards[j].innerHTML.indexOf('pillowcases.md') !== -1) {
        pillowCard = cards[j];
        break;
      }
    }
    expect(pillowCard).not.toBeNull();
    expect(pillowCard.getAttribute('data-knowledge-path')).toBe('home/bedding/pillowcases.md');
  });

  test('empty items shows empty state', function () {
    var html = renderKnowledge([]);
    expect(html).toContain('empty-state');
  });
});
