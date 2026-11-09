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
