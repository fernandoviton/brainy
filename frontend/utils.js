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
