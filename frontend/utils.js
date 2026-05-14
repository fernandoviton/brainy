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

// eslint-disable-next-line no-unused-vars
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
