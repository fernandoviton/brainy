// Tracker — UI wiring. Everything on screen is rendered from the current
// tracker's settings (areas, triggers, activities, exercises), so knee PT and
// any other tracker share this code. Logic: tracker-core.js; storage:
// tracker-store.js; charts: tracker-chart.js.
//
// URL: ?t=<tracker id> picks a tracker (otherwise the last used, or the only
// one). ?demo=1 runs on localStorage with no sign-in; ?demo=seed also fills a
// knee tracker with 30 days of sample data.

var TRK_DEMO = /[?&]demo=/.test(window.location.search);
var TRK_HISTORY_DAYS = 90;
var TRK_DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
var TRK_LAST_KEY = 'brainy.tracker.last';

// The Supabase library comes from a CDN; the service worker caches it after the
// first online visit, so it is only missing on a first-ever offline open.
var TRK_NO_CLIENT = !TRK_DEMO && typeof supabase === 'undefined';
var db;
if (!TRK_DEMO && !TRK_NO_CLIENT) db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var app = {
  makeStore: null, // tracker id -> base store
  trackerId: null,
  trackers: [],
  store: null,
  settings: null,
  entries: [],
  range: 14,
  flare: { pain: null, area: null, trigger: null },
  checkin: {},
  lastReminderCheck: Date.now(),
};

function $(id) { return document.getElementById(id); }

function trkToday() { return trkLocalDate(Date.now()); }

function trkDeviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
}

function trkClock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function trkFind(list, id) {
  return (list || []).filter(function (x) { return x.id === id; })[0] || null;
}

function trkLabel(list, id) {
  var item = trkFind(list, id);
  return item ? (item.label || item.name) : id;
}

function trkParam(name) {
  var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
  return m ? decodeURIComponent(m[1]) : null;
}

function trkRemember(id) {
  try { window.localStorage.setItem(TRK_LAST_KEY, id); } catch (e) { /* private mode */ }
}

// ── Toast ───────────────────────────────────────────────────────────────

var _toastTimer = null;
function trkToast(text, undo, isError) {
  var toast = $('toast');
  $('toast-text').textContent = text;
  toast.className = 'trk-toast' + (isError ? ' trk-toast-error' : '');
  var btn = $('toast-undo');
  btn.hidden = !undo;
  btn.onclick = function () {
    toast.hidden = true;
    if (undo) undo();
  };
  toast.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { toast.hidden = true; }, isError ? 7000 : 5000);
}

// ── Pickers ─────────────────────────────────────────────────────────────

function trkScaleHtml(field, label) {
  var html = '<div class="trk-scale" data-field="' + field + '" role="radiogroup" aria-label="' + escapeHtml(label) + ' 0 to 10">';
  for (var v = 0; v <= 10; v++) {
    html += '<button type="button" role="radio" aria-checked="false" data-value="' + v + '" class="trk-level-' + v + '">' + v + '</button>';
  }
  return html + '</div>';
}

function trkChipsHtml(items, selected) {
  return items.map(function (it) {
    var on = it.id === selected;
    return '<button type="button" role="radio" aria-checked="' + on + '" data-value="' + escapeHtml(it.id) + '"' +
      (on ? ' class="selected"' : '') + '>' + escapeHtml(it.label) + '</button>';
  }).join('');
}

function trkSelect(group, value) {
  var buttons = group.querySelectorAll('button[data-value]');
  for (var i = 0; i < buttons.length; i++) {
    var on = value !== null && buttons[i].getAttribute('data-value') === String(value);
    buttons[i].classList.toggle('selected', on);
    buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

// One delegated handler for every one-of-many button group on the page.
function trkOnPick(field, value, group) {
  trkSelect(group, value);
  if (field === 'flare-pain') app.flare.pain = +value;
  else if (field === 'flare-area') app.flare.area = value;
  else if (field === 'flare-trigger') app.flare.trigger = value;
  else if (field.indexOf('checkin-') === 0) app.checkin[field.slice(8)] = +value;
  else if (field === 'history-range') { app.range = +value; trkRenderHistory(); }
  trkUpdateButtons();
}

document.addEventListener('click', function (e) {
  var btn = e.target.closest && e.target.closest('[data-field] > button[data-value]');
  if (!btn) return;
  var group = btn.parentNode;
  trkOnPick(group.getAttribute('data-field'), btn.getAttribute('data-value'), group);
});

function trkUpdateButtons() {
  if (!app.settings) return;
  $('flare-save').disabled = app.flare.pain === null || !app.flare.trigger || !app.flare.area;
  $('checkin-save').disabled = app.settings.areas.some(function (a) { return app.checkin[a.id] === undefined; });
}

// ── Logging ─────────────────────────────────────────────────────────────

function trkLog(kind, fields, savedText) {
  var row;
  try {
    row = trkBuildEntry(kind, fields, Date.now(), app.settings);
  } catch (err) {
    trkToast(err.message, null, true);
    return Promise.resolve(null);
  }
  return app.store.addEntry(row).then(function (saved) {
    app.entries.unshift(saved);
    if (saved.queued) trkToast('No connection — saved on this phone, will sync');
    else trkToast(savedText, function () { trkDelete(saved.id); });
    trkRenderAll();
    return saved;
  }).catch(function (err) {
    trkToast('Not saved: ' + err.message, null, true);
    return null;
  });
}

function trkDelete(id) {
  if (!id) return Promise.resolve();
  return app.store.deleteEntry(id).then(function () {
    app.entries = app.entries.filter(function (e) { return e.id !== id; });
    trkRenderAll();
  }).catch(function (err) { trkToast('Delete failed: ' + err.message, null, true); });
}

function trkResetFlare() {
  var areas = app.settings.areas;
  app.flare = { pain: null, area: areas.length === 1 ? areas[0].id : (app.flare.area || areas[0].id), trigger: null };
  $('flare-note').value = '';
}

function trkWireForms() {
  $('flare-form').addEventListener('submit', function (e) {
    e.preventDefault();
    trkLog('flare', { pain: app.flare.pain, area: app.flare.area, trigger: app.flare.trigger, note: $('flare-note').value }, 'Flare logged')
      .then(function (saved) {
        if (!saved) return;
        trkResetFlare();
        trkRenderForms();
      });
  });

  $('checkin-form').addEventListener('submit', function (e) {
    e.preventDefault();
    trkLog('checkin', { scores: app.checkin }, app.settings.checkin_label + ' saved').then(function (saved) {
      if (!saved) return;
      app.checkin = {};
      trkRenderForms();
    });
  });

  $('activity-cards').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var input = form.querySelector('input');
    var act = trkFind(app.settings.activities, form.getAttribute('data-activity'));
    trkLog('activity', { item_id: act.id, detail: input.value }, act.label + ' logged').then(function (saved) {
      if (saved) input.value = '';
    });
  });

  $('exercise-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-exercise]');
    if (!btn) return;
    if (btn.getAttribute('data-entry')) {
      trkDelete(btn.getAttribute('data-entry'));
      return;
    }
    trkLog('exercise', { item_id: btn.getAttribute('data-exercise') }, 'Nice — exercise logged');
  });

  function onDeleteClick(e) {
    var btn = e.target.closest('button[data-delete]');
    if (btn) trkDelete(btn.getAttribute('data-delete'));
  }
  $('today-list').addEventListener('click', onDeleteClick);
  $('recent-list').addEventListener('click', onDeleteClick);
}

// ── Today ───────────────────────────────────────────────────────────────

function trkDescribe(e) {
  var s = app.settings;
  var note = e.note ? ': ' + e.note : '';
  if (e.kind === 'checkin') {
    return s.checkin_label + ' — ' + s.areas.map(function (a) {
      return a.label + ' ' + (e.scores && e.scores[a.id] !== undefined ? e.scores[a.id] : '–');
    }).join(' · ');
  }
  if (e.kind === 'flare') {
    var where = s.areas.length > 1 ? ' (' + (e.area === 'all' ? 'all' : trkLabel(s.areas, e.area)) + ')' : '';
    return 'Flare ' + e.pain + where + ' — ' + trkLabel(s.triggers, e.trigger) + note;
  }
  if (e.kind === 'activity') return (e.item_label || e.item_id) + (e.detail ? ' — ' + e.detail : '') + note;
  if (e.kind === 'exercise') return 'Did ' + (e.item_label || e.item_id) + note;
  return e.kind;
}

function trkEntryItems(entries, showDate) {
  if (!entries.length) return '<li class="trk-empty">Nothing yet.</li>';
  return entries.map(function (e) {
    var when = (showDate ? e.entry_date.slice(5).replace('-', '/') + ' ' : '') + trkClock(e.occurred_at);
    var del = e.queued ? '<span class="trk-queued">waiting to sync</span>'
      : '<button type="button" class="trk-del" data-delete="' + escapeHtml(e.id) + '" aria-label="Delete">×</button>';
    return '<li><span class="trk-when">' + escapeHtml(when) + '</span><span class="trk-what">' + escapeHtml(trkDescribe(e)) + '</span>' + del + '</li>';
  }).join('');
}

// The parts of the Today forms that depend on settings. Re-rendered after a
// save (to clear selections) and when settings change.
function trkRenderForms() {
  var s = app.settings;
  var flarePain = document.querySelector('[data-field="flare-pain"]');
  flarePain.outerHTML = trkScaleHtml('flare-pain', 'Flare pain');
  var areaItems = s.areas.length > 1 ? s.areas.concat([{ id: 'all', label: 'All' }]) : s.areas;
  if (!app.flare.area || (app.flare.area !== 'all' && !trkFind(s.areas, app.flare.area))) trkResetFlare();
  $('flare-area-wrap').hidden = s.areas.length === 1;
  document.querySelector('[data-field="flare-area"]').innerHTML = trkChipsHtml(areaItems, app.flare.area);
  document.querySelector('[data-field="flare-trigger"]').innerHTML = trkChipsHtml(s.triggers, app.flare.trigger);
  if (app.flare.pain !== null) trkSelect(document.querySelector('[data-field="flare-pain"]'), app.flare.pain);

  $('checkin-title').textContent = s.checkin_label;
  $('checkin-scales').innerHTML = s.areas.map(function (a) {
    return '<div class="trk-label">' + escapeHtml(a.label) + '</div>' + trkScaleHtml('checkin-' + a.id, a.label);
  }).join('');
  s.areas.forEach(function (a) {
    if (app.checkin[a.id] !== undefined) trkSelect(document.querySelector('[data-field="checkin-' + a.id + '"]'), app.checkin[a.id]);
  });

  $('activity-cards').innerHTML = s.activities.map(function (act) {
    return '<form class="trk-card" data-activity="' + escapeHtml(act.id) + '" autocomplete="off">' +
      '<h2>' + escapeHtml(act.label) + ' <span class="trk-done" data-activity-done="' + escapeHtml(act.id) + '"></span></h2>' +
      '<input class="trk-input" type="text" maxlength="500" placeholder="' + escapeHtml(act.prompt || 'Details (optional)') + '">' +
      '<button class="trk-secondary" type="submit">Log ' + escapeHtml(act.label.toLowerCase()) + '</button></form>';
  }).join('');
  trkUpdateButtons();
}

function trkRenderToday() {
  var s = app.settings;
  var today = trkToday();
  var todays = app.entries.filter(function (e) { return e.entry_date === today; });

  var checkin = todays.filter(function (e) { return e.kind === 'checkin'; })[0];
  $('checkin-done').textContent = checkin ? '✓ ' + s.areas.map(function (a) {
    return a.label.split(/\s+/)[0] + ' ' + (checkin.scores ? checkin.scores[a.id] : '');
  }).join(' · ') : '';
  $('checkin-form').classList.toggle('trk-first', !checkin && new Date().getHours() < 12);

  s.activities.forEach(function (act) {
    var el = document.querySelector('[data-activity-done="' + act.id + '"]');
    var done = todays.some(function (e) { return e.kind === 'activity' && e.item_id === act.id; });
    if (el) el.textContent = done ? '✓ logged' : '';
  });

  $('exercise-card').hidden = !s.exercises.length;
  var doneCount = 0;
  var required = 0;
  $('exercise-list').innerHTML = s.exercises.map(function (ex) {
    var done = todays.filter(function (e) { return e.kind === 'exercise' && e.item_id === ex.id; })[0];
    if (!ex.optional) required++;
    if (done && !ex.optional) doneCount++;
    var btn = done
      ? '<button type="button" class="trk-check done" data-exercise="' + escapeHtml(ex.id) + '"' +
        (done.queued ? '' : ' data-entry="' + escapeHtml(done.id) + '"') + ' aria-label="Undo">✓ ' + escapeHtml(trkClock(done.occurred_at)) + '</button>'
      : '<button type="button" class="trk-check" data-exercise="' + escapeHtml(ex.id) + '">Done</button>';
    return '<li class="' + (done ? 'is-done' : '') + '"><div><div class="trk-ex-name">' + escapeHtml(ex.name) +
      (ex.optional ? ' <span class="trk-optional">optional</span>' : '') + '</div>' +
      (ex.details ? '<div class="trk-ex-details">' + escapeHtml(ex.details) + '</div>' : '') + '</div>' + btn + '</li>';
  }).join('');
  $('exercise-count').textContent = required ? doneCount + '/' + required : '';

  $('today-list').innerHTML = trkEntryItems(todays, false);
}

// ── History ─────────────────────────────────────────────────────────────

function trkFmt(v) { return v === null || v === undefined ? '—' : (Math.round(v * 10) / 10).toString(); }

function trkRenderHistory() {
  var s = app.settings;
  var sum = trkSummarize(app.entries, s, trkToday(), app.range);
  var checked = sum.days.filter(function (d) { return d.worst !== null; });
  var avg = checked.length ? checked.reduce(function (a, d) { return a + d.worst; }, 0) / checked.length : null;
  var flares = sum.days.reduce(function (n, d) { return n + d.flares; }, 0);

  var tiles = [
    ['Avg ' + s.checkin_label.toLowerCase(), trkFmt(avg), (s.areas.length > 1 ? 'worst area, ' : '') + checked.length + ' days logged'],
    ['Flares', String(flares), 'in ' + app.range + ' days'],
  ];
  sum.activities.forEach(function (a) {
    tiles.push(['Flares per day', trkFmt(a.flaresPerDay) + ' vs ' + trkFmt(a.flaresPerOtherDay), a.label.toLowerCase() + 's (' + a.days + ') vs other days']);
    tiles.push(['Next-day score', trkFmt(a.nextWorstAfter) + ' vs ' + trkFmt(a.nextWorstAfterOther), 'after a ' + a.label.toLowerCase() + ' vs after other days']);
  });
  $('history-stats').innerHTML = tiles.map(function (t) {
    return '<div class="trk-stat"><div class="trk-stat-label">' + escapeHtml(t[0]) + '</div><div class="trk-stat-value">' + escapeHtml(t[1]) +
      '</div><div class="trk-stat-sub">' + escapeHtml(t[2]) + '</div></div>';
  }).join('');

  $('checkin-chart-title').textContent = s.checkin_label;
  var legend = s.areas.map(function (a, i) {
    return '<span><i class="trk-key" style="background:' + TRK_AREA_COLORS[i] + '"></i>' + escapeHtml(a.label) + '</span>';
  });
  if (s.activities.length) {
    legend.push('<span><i class="trk-key trk-key-activity"></i>' + escapeHtml(s.activities.length === 1 ? s.activities[0].label : 'Activity day') + '</span>');
  }
  $('chart-legend').innerHTML = legend.join('');

  var width = Math.max(260, Math.round($('checkin-chart').clientWidth || 340));
  $('checkin-chart').innerHTML = trkCheckinChartSvg(sum.days, s.areas, width);
  $('flare-chart').innerHTML = trkFlareChartSvg(sum.days, width);
  trkWireChartTips(sum.days);

  var maxCount = sum.triggers.length ? sum.triggers[0].count : 0;
  $('trigger-bars').innerHTML = sum.triggers.length ? sum.triggers.map(function (t) {
    return '<div class="trk-tbar"><span class="trk-tbar-label">' + escapeHtml(t.label) + '</span>' +
      '<span class="trk-tbar-track"><span class="trk-tbar-fill" style="width:' + Math.round((t.count / maxCount) * 100) + '%"></span></span>' +
      '<span class="trk-tbar-count">' + t.count + '</span></div>';
  }).join('') : '<p class="trk-empty">No flares in this range.</p>';

  var head = '<th>Date</th>' + s.areas.map(function (a) { return '<th>' + escapeHtml(a.label.split(/\s+/)[0]) + '</th>'; }).join('') +
    '<th>Flares</th><th>Max</th>' + s.activities.map(function (a) { return '<th>' + escapeHtml(a.label) + '</th>'; }).join('') + '<th>Ex.</th>';
  $('history-table').innerHTML = '<table><thead><tr>' + head + '</tr></thead><tbody>' +
    sum.days.slice().reverse().map(function (d) {
      return '<tr><td>' + d.date.slice(5) + '</td>' +
        s.areas.map(function (a) { return '<td>' + trkFmt(d.scores[a.id]) + '</td>'; }).join('') +
        '<td>' + d.flares + '</td><td>' + trkFmt(d.maxFlare) + '</td>' +
        s.activities.map(function (a) {
          var has = Object.prototype.hasOwnProperty.call(d.activities, a.id);
          return '<td>' + (has ? escapeHtml(d.activities[a.id] || 'yes') : '') + '</td>';
        }).join('') +
        '<td>' + (d.exercises || '') + '</td></tr>';
    }).join('') + '</tbody></table>';

  $('recent-list').innerHTML = trkEntryItems(app.entries.slice(0, 40), true);
}

function trkWireChartTips(days) {
  var tip = $('chart-tip');
  var card = tip.parentNode;
  function show(e) {
    var hit = e.target.closest && e.target.closest('.trk-hit');
    if (!hit) return;
    var d = days[+hit.getAttribute('data-index')];
    tip.innerHTML = trkDayTipText(d, app.settings).map(function (line, i) {
      return i === 0 ? '<strong>' + escapeHtml(line) + '</strong>' : '<div>' + escapeHtml(line) + '</div>';
    }).join('');
    tip.hidden = false;
    var cardBox = card.getBoundingClientRect();
    var box = hit.getBoundingClientRect();
    var left = box.left + box.width / 2 - cardBox.left - tip.offsetWidth / 2;
    tip.style.left = Math.max(4, Math.min(left, cardBox.width - tip.offsetWidth - 4)) + 'px';
    var above = box.top - cardBox.top - tip.offsetHeight - 6;
    tip.style.top = (above < 0 ? box.bottom - cardBox.top + 6 : above) + 'px';
    var cross = $('trk-crosshair');
    var x = +hit.getAttribute('x') + +hit.getAttribute('width') / 2;
    if (cross) {
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.setAttribute('visibility', 'visible');
    }
  }
  function hide() {
    tip.hidden = true;
    var cross = $('trk-crosshair');
    if (cross) cross.setAttribute('visibility', 'hidden');
  }
  ['checkin-chart', 'flare-chart'].forEach(function (id) {
    var el = $(id);
    el.onpointermove = show;
    el.onclick = show;
    el.onpointerleave = function (e) { if (e.pointerType === 'mouse') hide(); };
  });
}

// ── Settings ────────────────────────────────────────────────────────────

function trkDaysHtml(days) {
  return '<div class="trk-days">' + TRK_DAY_LETTERS.map(function (l, i) {
    var on = days.indexOf(i) !== -1;
    return '<button type="button" data-day="' + i + '" aria-pressed="' + on + '" class="' + (on ? 'selected' : '') + '">' + l + '</button>';
  }).join('') + '</div>';
}

function trkReadDays(container) {
  var out = [];
  var buttons = container.querySelectorAll('.trk-days button');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].classList.contains('selected')) out.push(+buttons[i].getAttribute('data-day'));
  }
  return out;
}

function _trkInput(name, value, placeholder, extra) {
  return '<input class="trk-input' + (extra || '') + '" name="' + name + '" placeholder="' + escapeHtml(placeholder) + '" value="' + escapeHtml(value || '') + '">';
}

var _trkRemove = '<button type="button" class="trk-remove">Remove</button>';

// One editor row per list item; `kind` matches the data-add buttons.
var TRK_ROWS = {
  area: function (a) {
    return '<div class="trk-edit-line">' + _trkInput('label', a.label, 'e.g. Right knee') + _trkRemove + '</div>';
  },
  trigger: function (t) {
    return '<div class="trk-edit-line">' + _trkInput('label', t.label, 'e.g. Sat a long time') + _trkRemove + '</div>';
  },
  activity: function (a) {
    return _trkInput('label', a.label, 'e.g. Lift day') + _trkInput('prompt', a.prompt, 'Question when logging (optional)') +
      '<div class="trk-edit-line">' + _trkRemove + '</div>';
  },
  exercise: function (ex) {
    return _trkInput('name', ex.name, 'Exercise name') + _trkInput('details', ex.details, 'How (sets, cues)') +
      '<div class="trk-edit-line"><label><input type="checkbox" name="optional"' + (ex.optional ? ' checked' : '') + '> Optional</label>' + _trkRemove + '</div>';
  },
  reminder: function (r) {
    return _trkInput('label', r.label, 'Reminder text') +
      '<div class="trk-edit-line"><input class="trk-input trk-time" type="time" name="time" value="' + escapeHtml(r.time || '12:00') + '">' +
      '<label><input type="checkbox" name="enabled"' + (r.enabled !== false ? ' checked' : '') + '> On</label>' + _trkRemove + '</div>' +
      trkDaysHtml(r.days || [0, 1, 2, 3, 4, 5, 6]);
  },
};

function trkRow(kind, item) {
  return '<div class="trk-edit-row" data-id="' + escapeHtml(item.id || '') + '">' + TRK_ROWS[kind](item) + '</div>';
}

function trkRenderSettings() {
  var s = app.settings;
  $('general-editor').innerHTML =
    '<div class="trk-label">Title</div>' + _trkInput('title', s.title, 'e.g. Knee PT') +
    '<div class="trk-label">Check-in name</div>' + _trkInput('checkin_label', s.checkin_label, 'e.g. Morning check-in') +
    '<p class="trk-hint">Tracker id: <code>' + escapeHtml(app.trackerId) + '</code> — link straight to it with <code>?t=' + escapeHtml(app.trackerId) + '</code>.</p>';
  $('area-editor').innerHTML = s.areas.map(function (x) { return trkRow('area', x); }).join('');
  $('trigger-editor').innerHTML = s.triggers.map(function (x) { return trkRow('trigger', x); }).join('');
  $('activity-editor').innerHTML = s.activities.map(function (x) { return trkRow('activity', x); }).join('');
  $('exercise-editor').innerHTML = s.exercises.map(function (x) { return trkRow('exercise', x); }).join('');
  $('reminder-editor').innerHTML = s.reminders.map(function (x) { return trkRow('reminder', x); }).join('');
  var b = s.breaks;
  $('breaks-editor').innerHTML =
    '<div class="trk-edit-line"><label><input type="checkbox" id="brk-enabled"' + (b.enabled ? ' checked' : '') + '> Remind me to take breaks</label></div>' +
    '<input class="trk-input" id="brk-label" placeholder="Break reminder text" value="' + escapeHtml(b.label) + '">' +
    '<div class="trk-edit-line">every <input class="trk-input trk-num" type="number" min="15" max="240" step="5" id="brk-every" value="' + b.every_minutes + '"> min</div>' +
    '<div class="trk-edit-line">from <input class="trk-input trk-time" type="time" id="brk-start" value="' + b.start + '"> to ' +
    '<input class="trk-input trk-time" type="time" id="brk-end" value="' + b.end + '"></div>' +
    '<div id="brk-days">' + trkDaysHtml(b.days) + '</div>';
  var device = trkDeviceZone();
  $('tz-editor').innerHTML = '<div class="trk-edit-line"><input class="trk-input" id="tz-input" value="' + escapeHtml(s.timezone) + '">' +
    (device !== s.timezone ? '<button type="button" class="trk-ghost trk-inline" id="tz-device">Use ' + escapeHtml(device) + '</button>' : '') +
    '</div><p class="trk-hint">Reminders fire at these times in this zone.</p>';
  if ($('tz-device')) $('tz-device').onclick = function () { $('tz-input').value = device; };
}

function trkCollectSettings() {
  function rows(id) { return Array.prototype.slice.call($(id).querySelectorAll('.trk-edit-row')); }
  function val(row, name) { return row.querySelector('[name="' + name + '"]').value; }
  function checked(row, name) { return row.querySelector('[name="' + name + '"]').checked; }
  function id(row) { return row.getAttribute('data-id') || null; }
  var general = $('general-editor');
  return {
    title: general.querySelector('[name="title"]').value,
    checkin_label: general.querySelector('[name="checkin_label"]').value,
    timezone: $('tz-input').value,
    areas: rows('area-editor').map(function (r) { return { id: id(r), label: val(r, 'label') }; }),
    triggers: rows('trigger-editor').map(function (r) { return { id: id(r), label: val(r, 'label') }; }),
    activities: rows('activity-editor').map(function (r) { return { id: id(r), label: val(r, 'label'), prompt: val(r, 'prompt') }; }),
    exercises: rows('exercise-editor').map(function (r) {
      return { id: id(r), name: val(r, 'name'), details: val(r, 'details'), optional: checked(r, 'optional') };
    }),
    reminders: rows('reminder-editor').map(function (r) {
      return { id: id(r), label: val(r, 'label'), time: val(r, 'time'), enabled: checked(r, 'enabled'), days: trkReadDays(r) };
    }),
    breaks: {
      enabled: $('brk-enabled').checked,
      label: $('brk-label').value,
      every_minutes: parseInt($('brk-every').value, 10),
      start: $('brk-start').value,
      end: $('brk-end').value,
      days: trkReadDays($('brk-days')),
    },
  };
}

function trkWireSettings() {
  $('tab-settings').addEventListener('click', function (e) {
    var day = e.target.closest('.trk-days button');
    if (day) {
      var on = !day.classList.contains('selected');
      day.classList.toggle('selected', on);
      day.setAttribute('aria-pressed', on);
      return;
    }
    var rm = e.target.closest('.trk-remove');
    if (rm) {
      rm.closest('.trk-edit-row').remove();
      return;
    }
    var add = e.target.closest('[data-add]');
    if (add) {
      var kind = add.getAttribute('data-add');
      var list = $(kind + '-editor');
      list.insertAdjacentHTML('beforeend', trkRow(kind, {}));
      list.lastElementChild.querySelector('input').focus();
    }
  });
  $('settings-save').addEventListener('click', function () {
    var next;
    try {
      next = trkNormalizeSettings(trkCollectSettings());
    } catch (err) {
      trkToast(err.message, null, true);
      return;
    }
    app.store.saveSettings(next).then(function () {
      app.settings = next;
      trkApplySettings();
      trkToast('Settings saved');
    }).catch(function (err) { trkToast('Settings not saved: ' + err.message, null, true); });
  });
  $('ics-download').addEventListener('click', function () {
    var blob = new Blob([trkBuildIcs(app.settings, trkToday(), app.trackerId)], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = trkSlug(app.settings.title) + '-reminders.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
}

// ── Push ────────────────────────────────────────────────────────────────

function trkBase64ToBytes(b64) {
  var pad = '='.repeat((4 - (b64.length % 4)) % 4);
  var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function trkPushStatus(text, showButton) {
  $('push-status').textContent = text;
  $('push-enable').hidden = !showButton;
}

function trkSetupPush() {
  var isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (TRK_DEMO) return trkPushStatus('Not available in demo mode.', false);
  if (!CONFIG.VAPID_PUBLIC_KEY) {
    return trkPushStatus('Not set up yet — the push sender needs VAPID keys (docs/tracker-app.md). Use the calendar file meanwhile.', false);
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return trkPushStatus(isIos && !standalone
      ? 'On iPhone, add this page to your Home Screen first (Share → Add to Home Screen), then open it from there.'
      : 'This browser does not support push.', false);
  }
  if (Notification.permission === 'denied') {
    return trkPushStatus('Blocked for this app — allow notifications in Settings, then reopen.', false);
  }
  navigator.serviceWorker.ready.then(function (reg) {
    return reg.pushManager.getSubscription();
  }).then(function (sub) {
    if (sub) {
      // Re-save on every load so a renewed endpoint replaces the stale one.
      app.store.savePushSubscription(sub.toJSON(), navigator.userAgent).catch(function () {});
      trkPushStatus('On for this device, for all your trackers. Sent by the Brainy scheduler (up to 15 min late).', false);
    } else {
      trkPushStatus('Off for this device.', true);
    }
  });
}

function trkEnablePush() {
  Notification.requestPermission().then(function (perm) {
    if (perm !== 'granted') throw new Error('permission ' + perm);
    return navigator.serviceWorker.ready;
  }).then(function (reg) {
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: trkBase64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  }).then(function (sub) {
    return app.store.savePushSubscription(sub.toJSON(), navigator.userAgent);
  }).then(function () {
    trkToast('Notifications on');
    trkSetupPush();
  }).catch(function (err) {
    trkToast('Could not enable notifications: ' + err.message, null, true);
  });
}

// ── Reminders while the app is open ─────────────────────────────────────

function trkRenderNextReminder() {
  var next = trkNextReminder(app.settings, Date.now());
  if (!next) {
    $('next-reminder').textContent = '';
    return;
  }
  var when = next.date === trkLocalDate(Date.now(), app.settings.timezone) ? next.time : TRK_DAY_LETTERS[new Date(next.at).getDay()] + ' ' + next.time;
  $('next-reminder').textContent = 'Next: ' + next.label + ' · ' + when;
}

function trkTick() {
  var now = Date.now();
  var due = trkRemindersDue(app.settings, app.lastReminderCheck, now);
  app.lastReminderCheck = now;
  if (due.length) {
    trkToast('⏰ ' + due[due.length - 1].label);
    if (navigator.vibrate) navigator.vibrate(200);
  }
  trkRenderNextReminder();
  if (trkLocalDate(now) !== app._renderedDay) trkRenderAll();
}

// ── Tabs, trackers and start-up ─────────────────────────────────────────

function trkRenderAll() {
  app._renderedDay = trkToday();
  trkRenderToday();
  if (!$('tab-history').hidden) trkRenderHistory();
  trkRenderNextReminder();
  var pending = app.store.pendingCount();
  $('outbox-msg').hidden = !pending;
  $('outbox-msg').textContent = pending + ' entr' + (pending === 1 ? 'y is' : 'ies are') + ' waiting to sync.';
}

// Settings changed (or a tracker was opened): rebuild everything they drive.
function trkApplySettings() {
  $('title').textContent = app.settings.title;
  document.title = app.settings.title;
  app.checkin = {};
  trkRenderForms();
  trkRenderSwitcher();
  trkRenderAll();
}

function trkShowTab(name) {
  ['today', 'history', 'settings'].forEach(function (t) { $('tab-' + t).hidden = t !== name; });
  var tabs = $('trk-tabs').querySelectorAll('button');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
  if (name === 'history') trkRenderHistory();
  if (name === 'settings') trkRenderSettings();
  window.scrollTo(0, 0);
}

function trkRenderSwitcher() {
  var sel = $('tracker-switch');
  var list = app.trackers.slice();
  if (!trkFind(list, app.trackerId)) list.push({ id: app.trackerId, title: app.settings.title });
  list.forEach(function (t) { if (t.id === app.trackerId) t.title = app.settings.title; });
  sel.innerHTML = list.map(function (t) {
    return '<option value="' + escapeHtml(t.id) + '"' + (t.id === app.trackerId ? ' selected' : '') + '>' + escapeHtml(t.title) + '</option>';
  }).join('') + '<option value="__new">+ New tracker…</option>';
  sel.hidden = false;
}

// Server rows plus anything still in the outbox (shown as "waiting to sync").
function trkReloadEntries() {
  var since = trkLocalDate(Date.now() - TRK_HISTORY_DAYS * 86400000);
  return app.store.listEntries(since).then(function (rows) {
    var queued = app.store.pending().map(function (r) { return Object.assign({ queued: true }, r); });
    app.entries = queued.concat(rows || []);
    trkRenderAll();
  });
}

function trkOpenTracker(id, presetId) {
  app.trackerId = id;
  trkRemember(id);
  app.store = trkWithOutbox(app.makeStore(id), window.localStorage, id);
  $('start-section').hidden = true;
  $('app-section').hidden = false;

  return app.store.flush().then(function () {
    return app.store.getSettings();
  }).then(function (stored) {
    if (stored) {
      app.settings = trkNormalizeSettings(stored);
    } else {
      app.settings = trkPresetSettings(presetId || id, trkDeviceZone());
      // Save straight away so the push sender has a schedule to read.
      app.store.saveSettings(app.settings).catch(function () {});
    }
    trkApplySettings();
    return trkReloadEntries();
  }).then(function () {
    trkSetupPush();
  }).catch(function (err) {
    if (!app.settings) app.settings = trkPresetSettings(presetId || id, trkDeviceZone());
    trkApplySettings();
    trkToast('Could not load: ' + err.message, null, true);
  });
}

function trkShowStart(canCancel) {
  $('app-section').hidden = true;
  $('start-section').hidden = false;
  $('start-cancel').hidden = !canCancel;
  $('title').textContent = 'Tracker';
  $('preset-list').innerHTML = TRK_PRESETS.map(function (p) {
    return '<button type="button" class="trk-secondary" data-preset="' + p.id + '">' + escapeHtml(p.label) + '</button>';
  }).join('');
}

function trkNewTrackerId(presetId) {
  var base = presetId === 'blank' ? 'tracker' : presetId;
  var id = base;
  var n = 2;
  while (trkFind(app.trackers, id)) id = base + '-' + n++;
  return id;
}

function trkStart(makeStore) {
  app.makeStore = makeStore;
  $('auth-section').hidden = true;
  return makeStore(null).listTrackers().catch(function () { return []; }).then(function (trackers) {
    app.trackers = trackers;
    var wanted = trkParam('t');
    var last = null;
    try { last = window.localStorage.getItem(TRK_LAST_KEY); } catch (e) { /* private mode */ }
    if (wanted) return trkOpenTracker(trkSlug(wanted));
    if (last && trkFind(trackers, last)) return trkOpenTracker(last);
    if (trackers.length) return trkOpenTracker(trackers[0].id);
    trkShowStart(false);
  });
}

function trkDemoSeed(store) {
  var settings = trkPresetSettings('knee', trkDeviceZone());
  var now = Date.now();
  var triggers = ['sat-a-long-time', 'car', 'car', 'stairs-down', 'after-lifting', 'sat-a-long-time'];
  var rows = [];
  for (var i = 29; i >= 1; i--) {
    var base = now - i * 86400000;
    var lift = [1, 3, 5].indexOf(new Date(base).getDay()) !== -1;
    var r = 3 + ((i * 7) % 4) - (i < 10 ? 1 : 0);
    rows.push(trkBuildEntry('checkin', { scores: { right: r, left: Math.max(0, r - 2) } }, base - 5 * 3600000, settings));
    if (lift) rows.push(trkBuildEntry('activity', { item_id: 'lift', detail: 'light squats 3×5, deadlift' }, base, settings));
    if (i % 3) rows.push(trkBuildEntry('exercise', { item_id: 'knee-extension-stretch' }, base + 3600000, settings));
    var flareCount = (lift ? 2 : 0) + (i % 4 === 0 ? 1 : 0);
    for (var f = 0; f < flareCount; f++) {
      rows.push(trkBuildEntry('flare', { pain: 4 + ((i + f) % 4), area: 'right', trigger: triggers[(i + f) % triggers.length] }, base + (f + 2) * 3600000, settings));
    }
  }
  return store.saveSettings(settings).then(function () {
    return rows.reduce(function (p, row) { return p.then(function () { return store.addEntry(row); }); }, Promise.resolve());
  });
}

trkWireForms();
trkWireSettings();
$('push-enable').addEventListener('click', trkEnablePush);
$('trk-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-tab]');
  if (btn) trkShowTab(btn.getAttribute('data-tab'));
});
$('tracker-switch').addEventListener('change', function (e) {
  var id = e.target.value;
  if (id === '__new') {
    e.target.value = app.trackerId;
    trkShowStart(true);
    return;
  }
  trkShowTab('today');
  trkOpenTracker(id);
});
$('preset-list').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-preset]');
  if (!btn) return;
  var preset = btn.getAttribute('data-preset');
  var id = trkNewTrackerId(preset);
  app.trackers.push({ id: id, title: id });
  trkShowTab('today');
  trkOpenTracker(id, preset).then(function () {
    if (preset === 'blank') trkShowTab('settings');
  });
});
$('start-cancel').addEventListener('click', function () {
  $('start-section').hidden = true;
  $('app-section').hidden = false;
  $('title').textContent = app.settings.title;
});
setInterval(function () { if (app.settings) trkTick(); }, 30000);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && app.settings) {
    app.lastReminderCheck = Date.now();
    app.store.flush().then(function (sent) {
      if (!sent) return trkRenderAll();
      trkToast(sent + ' queued entr' + (sent === 1 ? 'y' : 'ies') + ' synced');
      return trkReloadEntries();
    });
  }
});

if (TRK_NO_CLIENT) {
  $('auth-section').hidden = false;
  $('auth-section').querySelector('p').textContent = 'Could not load the sign-in library — check your connection and reopen.';
  $('login-btn').hidden = true;
} else if (TRK_DEMO) {
  $('demo-banner').hidden = false;
  $('logout-btn').hidden = true;
  var makeDemoStore = function (id) { return trkLocalStore(window.localStorage, id); };
  var seed = /[?&]demo=seed/.test(window.location.search);
  makeDemoStore('knee').getSettings().then(function (existing) {
    return seed && !existing ? trkDemoSeed(makeDemoStore('knee')) : null;
  }).then(function () { trkStart(makeDemoStore); });
} else {
  var started = false;
  db.auth.onAuthStateChange(function (event, session) {
    if (session && !started) {
      started = true;
      trkStart(function (id) { return trkSupabaseStore(db, session.user.id, id); });
    } else if (!session) {
      started = false;
      $('auth-section').hidden = false;
      $('app-section').hidden = true;
      $('start-section').hidden = true;
    }
  });
  $('login-btn').addEventListener('click', function () {
    db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
  });
  $('logout-btn').addEventListener('click', function () {
    // 'local' ends only this browser's session; 'global' would also revoke the CLI's token.
    db.auth.signOut({ scope: 'local' });
  });
}
