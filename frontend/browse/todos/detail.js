// Pure helpers for the TODO detail drawer: archive rows, archived collateral
// snapshots, and the markup for a TODO's attachments. Rendering functions are
// passed in (markdown, escaping) so this stays testable without a DOM.
(function (root) {
  // `todo archive` copies the row into brainy_archive_entries (with snapshots
  // of the TODO and its collateral) and deletes the live row.
  var ARCHIVE_COLUMNS = 'id, todo_name, completion_date, year_month, summary_text, todo_snapshot, collateral_snapshot';

  function archiveRowToTodo(r) {
    var snap = r.todo_snapshot || {};
    var summary = r.summary_text || '';
    return {
      id: r.id,
      name: r.todo_name,
      status: 'archived',
      priority: snap.priority || null,
      category: snap.category || null,
      summary: summary.split(/\n\n/)[0],
      notes: summary,
      completion_date: r.completion_date || null,
      archived: true,
      collateralSnapshot: r.collateral_snapshot || null,
    };
  }

  // Old archive entries stored collateral as bare filenames (content lost).
  function normalizeArchivedCollateral(snap) {
    if (!snap || !snap.length) return [];
    return snap.map(function (entry) {
      if (typeof entry === 'string') {
        return { filename: entry, content_type: null, storage_path: null, text_content: null, legacy: true };
      }
      return entry;
    });
  }

  // Text attachments render inline in a collapsible box (markdown for .md or a
  // markdown content type); files become [data-storage-path] placeholders that
  // utils.js resolveAttachmentLinks() turns into links.
  function collateralHtml(items, renderMarkdown, escapeHtml) {
    if (!items || !items.length) return '';
    var html = '<div class="card-collateral">';
    items.forEach(function (item) {
      if (item.text_content) {
        var isMd = (item.content_type && /markdown/.test(item.content_type)) || (item.filename && /\.md$/i.test(item.filename));
        var content = isMd ? renderMarkdown(item.text_content) : '<pre>' + escapeHtml(item.text_content) + '</pre>';
        html += '<div class="collateral-box">' +
          '<div class="collateral-box-header collateral-toggle">' +
            '<span class="collateral-chevron">&#x25B6;</span>' +
            '<span class="collateral-box-filename">' + escapeHtml(item.filename) + '</span>' +
          '</div>' +
          '<div class="collateral-box-body">' + content + '</div>' +
        '</div>';
      } else if (item.storage_path) {
        html += '<div class="collateral-box collateral-box-link">' +
          '<span class="collateral-file-link" data-storage-path="' + escapeHtml(item.storage_path) + '"' +
            (item.content_type ? ' data-content-type="' + escapeHtml(item.content_type) + '"' : '') + '>' +
            escapeHtml(item.filename) +
          '</span>' +
        '</div>';
      } else if (item.legacy) {
        html += '<div class="collateral-box collateral-box-link">' +
          '<span class="collateral-file-link">' + escapeHtml(item.filename) + '</span>' +
          '<span class="archived-empty-note"> (content not preserved)</span>' +
        '</div>';
      }
    });
    return html + '</div>';
  }

  var api = {
    ARCHIVE_COLUMNS: ARCHIVE_COLUMNS,
    archiveRowToTodo: archiveRowToTodo,
    normalizeArchivedCollateral: normalizeArchivedCollateral,
    collateralHtml: collateralHtml,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TodoDetail = api;
})(this);
