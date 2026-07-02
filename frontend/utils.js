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

// eslint-disable-next-line no-unused-vars
function setupLiveSearch(inputEl, getItems, fields, onFiltered) {
  inputEl.addEventListener('input', function () {
    var q = inputEl.value.trim().toLowerCase();
    var items = getItems() || [];
    if (!q) { onFiltered(items); return; }
    var filtered = items.filter(function (item) {
      for (var i = 0; i < fields.length; i++) {
        var v = item[fields[i]];
        if (v && String(v).toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    });
    onFiltered(filtered);
  });
}

// Deep links use the URL hash as "#key=value" (e.g. #todo=fix-bug,
// #knowledge=tools/git/rebase.md) so they work on static hosting.

function parseDeepLinkHash(hash, key) {
  hash = hash || '';
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
function getDeepLink(key) {
  return parseDeepLinkHash((window.location && window.location.hash) || '', key);
}

var DEEP_LINK_STASH_KEY = 'brainy-deep-link';

// The OAuth sign-in redirect drops the URL hash, so pages stash the deep link
// in sessionStorage before redirecting and recover it after the round-trip.

// eslint-disable-next-line no-unused-vars
function stashDeepLink() {
  try {
    var hash = (window.location && window.location.hash) || '';
    if (hash.length > 1) window.sessionStorage.setItem(DEEP_LINK_STASH_KEY, hash);
  } catch (e) { /* sessionStorage unavailable */ }
}

// One-shot: reads and clears the stash.
// eslint-disable-next-line no-unused-vars
function getStashedDeepLink(key) {
  try {
    var hash = window.sessionStorage.getItem(DEEP_LINK_STASH_KEY);
    if (!hash) return null;
    window.sessionStorage.removeItem(DEEP_LINK_STASH_KEY);
    return parseDeepLinkHash(hash, key);
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
