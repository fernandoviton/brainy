// Shared utility functions

// eslint-disable-next-line no-unused-vars
function formatDate(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr);
  var now = new Date();
  var diffMs = now - d;
  var diffMins = Math.floor(diffMs / 60000);
  var diffHrs = Math.floor(diffMs / 3600000);
  var diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return diffMins + 'm ago';
  if (diffHrs < 24) return diffHrs + 'h ago';
  if (diffDays < 7) return diffDays + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

// eslint-disable-next-line no-unused-vars
function truncate(str, maxLen) {
  maxLen = maxLen || 120;
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '\u2026';
}

// Substring match of `query` against any of `fields`. Exposed separately from
// setupLiveSearch so a page can re-apply the current search text to a freshly
// loaded list (e.g. after a filter switch) without duplicating the match rules.
// eslint-disable-next-line no-unused-vars
function filterItems(items, fields, query) {
  var q = (query || '').trim().toLowerCase();
  items = items || [];
  if (!q) return items;
  return items.filter(function (item) {
    for (var i = 0; i < fields.length; i++) {
      var v = item[fields[i]];
      if (v && String(v).toLowerCase().indexOf(q) !== -1) return true;
    }
    return false;
  });
}

// eslint-disable-next-line no-unused-vars
function setupLiveSearch(inputEl, getItems, fields, onFiltered) {
  inputEl.addEventListener('input', function () {
    onFiltered(filterItems(getItems(), fields, inputEl.value));
  });
}

// Deep links use the URL hash as "#key=value" (e.g. #todo=fix-bug,
// #knowledge=tools/git/rebase.md) so they work on static hosting.

// eslint-disable-next-line no-unused-vars
function getDeepLink(key) {
  var hash = (window.location && window.location.hash) || '';
  if (hash.charAt(0) === '#') hash = hash.substring(1);
  var eq = hash.indexOf('=');
  if (eq === -1 || hash.substring(0, eq) !== key) return null;
  try {
    return decodeURIComponent(hash.substring(eq + 1));
  } catch (e) {
    return null;
  }
}

// eslint-disable-next-line no-unused-vars
function setDeepLink(key, value) {
  // Keep slashes literal so knowledge paths stay readable in the URL.
  var hash = value ? '#' + key + '=' + encodeURIComponent(value).replace(/%2F/gi, '/') : '';
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', hash || window.location.pathname);
  } else {
    window.location.hash = hash;
  }
}

// eslint-disable-next-line no-unused-vars
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ── Attachment links ─────────────────────────────────────────────
// Supabase Storage serves HTML as text/plain with nosniff (anti-XSS on the
// storage domain), so an .html attachment's signed URL shows source. Those
// open in browse/viewer/ instead, which renders them in a sandboxed iframe.

// eslint-disable-next-line no-unused-vars
function isHtmlAttachment(filename, contentType) {
  if (contentType && /^text\/html\b/i.test(contentType)) return true;
  return !!filename && /\.html?$/i.test(filename);
}

// Relative to a browse page (browse/<page>/). The path rides in the hash so
// it never reaches the static host's logs.
// eslint-disable-next-line no-unused-vars
function attachmentViewerHref(storagePath, filename) {
  return '../viewer/#path=' + encodeURIComponent(storagePath) +
    '&name=' + encodeURIComponent(filename || '');
}

// Replace each [data-storage-path] placeholder in `containerEl` (filename as
// its text, optional data-content-type) with a link that opens in a new tab:
// the viewer for HTML, a 1-hour signed URL from `bucket` for everything else.
// eslint-disable-next-line no-unused-vars
function resolveAttachmentLinks(containerEl, bucket) {
  var placeholders = containerEl.querySelectorAll('[data-storage-path]');
  if (!placeholders || !placeholders.length) return;

  function link(el, href) {
    var a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.className = 'collateral-file-link';
    a.textContent = el.textContent;
    if (el.parentNode && el.parentNode.replaceChild) {
      el.parentNode.replaceChild(a, el);
    }
  }

  for (var i = 0; i < placeholders.length; i++) {
    (function (el) {
      var storagePath = el.getAttribute('data-storage-path');
      if (isHtmlAttachment(el.textContent, el.getAttribute('data-content-type'))) {
        link(el, attachmentViewerHref(storagePath, el.textContent));
        return;
      }
      bucket.createSignedUrl(storagePath, 3600)
        .then(function (result) {
          if (result.data && result.data.signedUrl) link(el, result.data.signedUrl);
        });
    })(placeholders[i]);
  }
}

// ── Cross-references ─────────────────────────────────────────────
// Notes and knowledge mention other items by name (`plan-italy-trip`,
// `travel/trips/italy-apr-2027.md`). The stored text stays plain; links are
// built here, at render time, from the names that exist in the store, so they
// never bake in a host and only appear for real items.

// Relative to a browse page (browse/<page>/).
// eslint-disable-next-line no-unused-vars
function todoHref(name) {
  return '../todos/#todo=' + encodeURIComponent(name);
}

// eslint-disable-next-line no-unused-vars
function knowledgeHref(path) {
  return '../knowledge/#knowledge=' + encodeURIComponent(path).replace(/%2F/gi, '/');
}

var REFERENCE_INDEX_LIMIT = 5000;
var _referenceIndexPromise = null;

// Resolves to { todos: {name: true}, knowledge: {path: true} }, covering live
// and archived TODOs. Fetched once per page load; a failed table just
// contributes nothing.
// eslint-disable-next-line no-unused-vars
function loadReferenceIndex(client) {
  if (_referenceIndexPromise) return _referenceIndexPromise;
  function rows(table, column) {
    return new Promise(function (resolve) {
      client.from(table).select(column).limit(REFERENCE_INDEX_LIMIT).then(function (result) {
        resolve((result && !result.error && result.data) || []);
      }, function () { resolve([]); });
    });
  }
  _referenceIndexPromise = Promise.all([
    rows('brainy_todos', 'name'),
    rows('brainy_archive_entries', 'todo_name'),
    rows('brainy_knowledge', 'path'),
  ]).then(function (res) {
    var index = { todos: {}, knowledge: {} };
    res[0].forEach(function (r) { if (r.name) index.todos[r.name] = true; });
    res[1].forEach(function (r) { if (r.todo_name) index.todos[r.todo_name] = true; });
    res[2].forEach(function (r) { if (r.path) index.knowledge[r.path] = true; });
    return index;
  });
  return _referenceIndexPromise;
}

function referenceHref(text, index) {
  if (Object.prototype.hasOwnProperty.call(index.knowledge, text)) return knowledgeHref(text);
  if (Object.prototype.hasOwnProperty.call(index.todos, text)) return todoHref(text);
  return null;
}

function hasAncestor(node, root, tags) {
  for (var el = node.parentNode; el && el !== root; el = el.parentNode) {
    if (el.nodeName && tags.indexOf(el.nodeName.toLowerCase()) !== -1) return true;
  }
  return false;
}

function referenceLink(href) {
  var a = document.createElement('a');
  a.href = href;
  a.className = 'ref-link';
  return a;
}

// Bare text only matches multi-word TODO names (a lone "recurring" in prose is
// too likely to be an ordinary word) and knowledge paths. Boundaries stop
// "plan-italy-trip-2" or "a/home/x.md" from matching a shorter name, while a
// sentence-ending period is still allowed after a path.
function bareReferencePattern(index) {
  var terms = Object.keys(index.knowledge).concat(
    Object.keys(index.todos).filter(function (n) { return n.indexOf('-') !== -1; }));
  if (!terms.length) return null;
  terms.sort(function (a, b) { return b.length - a.length; });
  var alternation = terms.map(function (t) {
    return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|');
  return new RegExp('(^|[^\\w/.-])(' + alternation + ')(?![\\w/-]|\\.\\w)', 'g');
}

// Turn references to known TODOs / knowledge entries inside `containerEl`
// (already-rendered markdown) into links. A `code` span links when its whole
// text is a known name or path; plain text links on known multi-word names and
// paths. Existing links and code blocks are left alone, so re-running is safe.
// eslint-disable-next-line no-unused-vars
function linkifyReferences(containerEl, index) {
  if (!index || !containerEl || !containerEl.querySelectorAll ||
      typeof document === 'undefined' || !document.createTreeWalker) return;

  var codes = containerEl.querySelectorAll('code');
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    if (hasAncestor(code, containerEl, ['a', 'pre'])) continue;
    var href = referenceHref(code.textContent.trim(), index);
    if (!href) continue;
    var a = referenceLink(href);
    code.parentNode.replaceChild(a, code);
    a.appendChild(code);
  }

  var pattern = bareReferencePattern(index);
  if (!pattern) return;
  var walker = document.createTreeWalker(containerEl, 4 /* NodeFilter.SHOW_TEXT */);
  var textNodes = [];
  while (walker.nextNode()) {
    if (!hasAncestor(walker.currentNode, containerEl, ['a', 'code', 'pre', 'script', 'style'])) {
      textNodes.push(walker.currentNode);
    }
  }
  textNodes.forEach(function (node) {
    var text = node.nodeValue;
    pattern.lastIndex = 0;
    var m;
    var last = 0;
    var frag = null;
    while ((m = pattern.exec(text)) !== null) {
      var start = m.index + m[1].length;
      frag = frag || document.createDocumentFragment();
      frag.appendChild(document.createTextNode(text.substring(last, start)));
      var link = referenceLink(referenceHref(m[2], index));
      link.textContent = m[2];
      frag.appendChild(link);
      last = start + m[2].length;
    }
    if (!frag) return;
    frag.appendChild(document.createTextNode(text.substring(last)));
    node.parentNode.replaceChild(frag, node);
  });
}
