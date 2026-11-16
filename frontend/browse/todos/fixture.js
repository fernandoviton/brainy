// Fake TODOs for the board's mock mode (localhost, no Supabase config) and its
// tests. Everything here is invented: this repo is public, so never paste a
// real TODO into it. Due dates are relative to `today` so the due strip always
// has something in each bucket.
(function (root) {
  function rows(today) {
    var core = root.BoardCore || (typeof require !== 'undefined' ? require('./core') : null);
    today = today || core.localToday();
    var d = function (n) { return core.addDays(today, n); };
    var list = [
      ['demo-water-plants', 'inbox', 'P2', 'home', 'Water the demo plants', null],
      ['demo-sort-mail', 'inbox', 'P3', 'errands', 'Sort the example mail pile', d(4)],
      ['demo-new-idea', 'inbox', null, null, 'An idea with no priority or category', null],
      ['demo-fix-faucet', 'active', 'P1', 'home', 'Fix the pretend dripping faucet', d(-3)],
      ['demo-renew-library-card', 'active', 'P0', 'errands', 'Renew the sample library card', d(0)],
      ['demo-paint-fence', 'active', 'P1', 'home', 'Buy paint for the imaginary fence', d(2)],
      ['demo-plan-picnic', 'active', 'P2', 'fun', 'Plan a made-up picnic', d(7)],
      ['demo-clean-garage', 'active', 'P2', 'home', 'Clear one shelf in the demo garage', null],
      ['demo-learn-juggling', 'later', 'P3', 'fun', 'Learn to juggle three example balls', null],
      ['demo-backup-photos', 'later', 'P2', 'tech', 'Back up the pretend photo library', d(-10)],
      ['demo-reorder-filters', 'scheduled', 'P2', 'home', 'Order replacement demo filters', null, d(14)],
      ['demo-check-tires', 'scheduled', 'P1', 'errands', 'Check the sample car tires', d(1), d(5)],
    ];
    return list.map(function (r, i) {
      return {
        id: 'demo-' + (i + 1),
        name: r[0], status: r[1], priority: r[2], category: r[3], summary: r[4],
        due: r[5], scheduled_date: r[6] || null, notes: NOTES[r[0]] || null,
        created_at: '2030-01-01T10:00:' + (i < 10 ? '0' : '') + i + '.000Z',
      };
    });
  }

  var NOTES = {
    'demo-fix-faucet': '## Plan\n\n- Buy a demo washer\n- See also `demo-paint-fence`',
  };

  // Extra tables for the detail drawer: attachments and the archive.
  function tables() {
    return {
      brainy_todo_collateral: [
        { id: 'c1', todo_id: 'demo-4', filename: 'parts.md', content_type: 'text/markdown', text_content: '# Parts list\n\n- one demo washer', storage_path: null },
        { id: 'c2', todo_id: 'demo-4', filename: 'photo.jpg', content_type: 'image/jpeg', text_content: null, storage_path: 'todos/demo-4/photo.jpg' },
      ],
      brainy_archive_entries: [
        { id: 'a1', todo_name: 'demo-old-move', completion_date: '2030-02-01', year_month: '2030-02',
          summary_text: 'Moved the sample boxes.', todo_snapshot: { priority: 'P2', category: 'home' }, collateral_snapshot: null },
        { id: 'a2', todo_name: 'demo-old-taxes', completion_date: '2030-03-01', year_month: '2030-03',
          summary_text: 'Filed the pretend return.\n\nKept the example receipts.', todo_snapshot: { priority: 'P1', category: 'finance' },
          collateral_snapshot: ['receipt.pdf'] },
      ],
      brainy_knowledge: [],
    };
  }

  var api = { rows: rows, tables: tables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BoardFixture = api;
})(this);
