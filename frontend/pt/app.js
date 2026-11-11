// Knee PT — UI wiring. Logic lives in pt-core.js, storage in pt-store.js,
// charts in pt-chart.js. `?demo=1` runs against localStorage with no sign-in
// (`?demo=seed` also fills 30 days of sample data) for local testing.

var PT_DEMO = /[?&]demo=/.test(window.location.search);
var PT_HISTORY_DAYS = 90;
var PT_DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// The Supabase library comes from a CDN; the service worker caches it after the
// first online visit, so it is only missing on a first-ever offline open.
var PT_NO_CLIENT = !PT_DEMO && typeof supabase === 'undefined';
var db;
if (!PT_DEMO && !PT_NO_CLIENT) db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY);

var pt = {
  store: null,
  settings: null,
  entries: [],
  range: 14,
  flare: { pain: null, side: 'right', trigger: null },
  morning: { right: null, left: null },
  lastReminderCheck: Date.now(),
};

function $(id) { return document.getElementById(id); }

function ptToday() { return ptLocalDate(Date.now()); }

function ptDeviceZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; }
}

function ptClock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function ptTriggerLabel(id) {
  var t = PT_TRIGGERS.filter(function (x) { return x.id === id; })[0];
  return t ? t.label : id;
}

// ── Toast ───────────────────────────────────────────────────────────────

var _toastTimer = null;
function ptToast(text, undo, isError) {
  var toast = $('toast');
  $('toast-text').textContent = text;
  toast.className = 'pt-toast' + (isError ? ' pt-toast-error' : '');
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

function ptBuildScales() {
  var scales = document.querySelectorAll('.pt-scale');
  for (var i = 0; i < scales.length; i++) {
    var html = '';
    for (var v = 0; v <= 10; v++) {
      html += '<button type="button" role="radio" aria-checked="false" data-value="' + v + '" class="pt-level-' + v + '">' + v + '</button>';
    }
    scales[i].innerHTML = html;
  }
  var trig = document.querySelector('[data-field="flare-trigger"]');
  trig.innerHTML = PT_TRIGGERS.map(function (t) {
    return '<button type="button" role="radio" aria-checked="false" data-value="' + t.id + '">' + escapeHtml(t.label) + '</button>';
  }).join('');
}

// One-of-many button group: highlights the tapped button and reports its value.
function ptPicker(field, onPick) {
  var group = document.querySelector('[data-field="' + field + '"]');
  group.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-value]');
    if (!btn) return;
    ptSelect(group, btn.getAttribute('data-value'));
    onPick(btn.getAttribute('data-value'));
  });
}

function ptSelect(group, value) {
  var buttons = group.querySelectorAll('button[data-value]');
  for (var i = 0; i < buttons.length; i++) {
    var on = value !== null && buttons[i].getAttribute('data-value') === String(value);
    buttons[i].classList.toggle('selected', on);
    buttons[i].setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

function ptField(field) { return document.querySelector('[data-field="' + field + '"]'); }

// ── Logging ─────────────────────────────────────────────────────────────

var PT_SAVED_TEXT = { morning: 'Morning pain saved', flare: 'Flare logged', lift: 'Lift day logged', exercise: 'Nice — exercise logged' };

function ptLog(kind, fields) {
  var row;
  try {
    row = ptBuildEntry(kind, fields, Date.now());
  } catch (err) {
    ptToast(err.message, null, true);
    return Promise.resolve(null);
  }
  return pt.store.addEntry(row).then(function (saved) {
    if (saved.queued) {
      pt.entries.unshift(saved);
      ptToast('No connection — saved on this phone, will sync');
    } else {
      pt.entries.unshift(saved);
      ptToast(PT_SAVED_TEXT[kind], function () { ptDelete(saved.id); });
    }
    ptRenderAll();
    return saved;
  }).catch(function (err) {
    ptToast('Not saved: ' + err.message, null, true);
    return null;
  });
}

function ptDelete(id) {
  if (!id) return Promise.resolve();
  return pt.store.deleteEntry(id).then(function () {
    pt.entries = pt.entries.filter(function (e) { return e.id !== id; });
    ptRenderAll();
  }).catch(function (err) { ptToast('Delete failed: ' + err.message, null, true); });
}

function ptWireForms() {
  ptPicker('flare-pain', function (v) { pt.flare.pain = +v; ptUpdateButtons(); });
  ptPicker('flare-side', function (v) { pt.flare.side = v; });
  ptPicker('flare-trigger', function (v) { pt.flare.trigger = v; ptUpdateButtons(); });
  ptPicker('morning-right', function (v) { pt.morning.right = +v; ptUpdateButtons(); });
  ptPicker('morning-left', function (v) { pt.morning.left = +v; ptUpdateButtons(); });
  ptPicker('history-range', function (v) { pt.range = +v; ptRenderHistory(); });

  $('flare-form').addEventListener('submit', function (e) {
    e.preventDefault();
    ptLog('flare', { pain: pt.flare.pain, side: pt.flare.side, trigger: pt.flare.trigger, note: $('flare-note').value })
      .then(function (saved) {
        if (!saved) return;
        pt.flare.pain = null;
        pt.flare.trigger = null;
        $('flare-note').value = '';
        ptSelect(ptField('flare-pain'), null);
        ptSelect(ptField('flare-trigger'), null);
        ptUpdateButtons();
      });
  });

  $('morning-form').addEventListener('submit', function (e) {
    e.preventDefault();
    ptLog('morning', { pain_right: pt.morning.right, pain_left: pt.morning.left }).then(function (saved) {
      if (!saved) return;
      pt.morning = { right: null, left: null };
      ptSelect(ptField('morning-right'), null);
      ptSelect(ptField('morning-left'), null);
      ptUpdateButtons();
    });
  });

  $('lift-form').addEventListener('submit', function (e) {
    e.preventDefault();
    ptLog('lift', { lift_notes: $('lift-notes').value }).then(function (saved) {
      if (saved) $('lift-notes').value = '';
    });
  });

  $('exercise-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-exercise]');
    if (!btn) return;
    var doneId = btn.getAttribute('data-entry');
    if (doneId) {
      ptDelete(doneId);
      return;
    }
    var ex = pt.settings.exercises.filter(function (x) { return x.id === btn.getAttribute('data-exercise'); })[0];
    if (ex) ptLog('exercise', { exercise_id: ex.id, exercise_name: ex.name });
  });

  function onDeleteClick(e) {
    var btn = e.target.closest('button[data-delete]');
    if (btn) ptDelete(btn.getAttribute('data-delete'));
  }
  $('today-list').addEventListener('click', onDeleteClick);
  $('recent-list').addEventListener('click', onDeleteClick);
}

function ptUpdateButtons() {
  $('flare-save').disabled = pt.flare.pain === null || !pt.flare.trigger;
  $('morning-save').disabled = pt.morning.right === null || pt.morning.left === null;
}

// ── Today ───────────────────────────────────────────────────────────────

function ptDescribe(e) {
  if (e.kind === 'morning') return 'Morning — R ' + e.pain_right + ' · L ' + e.pain_left;
  if (e.kind === 'flare') {
    return 'Flare ' + e.pain + ' (' + e.side + ') — ' + ptTriggerLabel(e.trigger) + (e.note ? ': ' + e.note : '');
  }
  if (e.kind === 'lift') return 'Lift day' + (e.lift_notes ? ' — ' + e.lift_notes : '');
  if (e.kind === 'exercise') return 'Did ' + (e.exercise_name || e.exercise_id);
  return e.kind;
}

function ptEntryItems(entries, showDate) {
  if (!entries.length) return '<li class="pt-empty">Nothing yet.</li>';
  return entries.map(function (e) {
    var when = (showDate ? e.entry_date.slice(5).replace('-', '/') + ' ' : '') + ptClock(e.occurred_at);
    var del = e.queued ? '<span class="pt-queued">waiting to sync</span>'
      : '<button type="button" class="pt-del" data-delete="' + escapeHtml(e.id) + '" aria-label="Delete">×</button>';
    return '<li><span class="pt-when">' + escapeHtml(when) + '</span><span class="pt-what">' + escapeHtml(ptDescribe(e)) + '</span>' + del + '</li>';
  }).join('');
}

function ptRenderToday() {
  var today = ptToday();
  var todays = pt.entries.filter(function (e) { return e.entry_date === today; });

  var morning = todays.filter(function (e) { return e.kind === 'morning'; })[0];
  $('morning-done').textContent = morning ? '✓ R ' + morning.pain_right + ' · L ' + morning.pain_left : '';
  $('morning-form').classList.toggle('pt-first', !morning && new Date().getHours() < 12);
  var lifts = todays.filter(function (e) { return e.kind === 'lift'; });
  $('lift-done').textContent = lifts.length ? '✓ logged' : '';

  var doneCount = 0;
  var required = 0;
  $('exercise-list').innerHTML = pt.settings.exercises.map(function (ex) {
    var done = todays.filter(function (e) { return e.kind === 'exercise' && e.exercise_id === ex.id; })[0];
    if (!ex.optional) required++;
    if (done && !ex.optional) doneCount++;
    var btn = done
      ? '<button type="button" class="pt-check done" data-exercise="' + escapeHtml(ex.id) + '"' +
        (done.queued ? '' : ' data-entry="' + escapeHtml(done.id) + '"') + ' aria-label="Undo">✓ ' + escapeHtml(ptClock(done.occurred_at)) + '</button>'
      : '<button type="button" class="pt-check" data-exercise="' + escapeHtml(ex.id) + '">Done</button>';
    return '<li class="' + (done ? 'is-done' : '') + '"><div><div class="pt-ex-name">' + escapeHtml(ex.name) +
      (ex.optional ? ' <span class="pt-optional">optional</span>' : '') + '</div>' +
      (ex.details ? '<div class="pt-ex-details">' + escapeHtml(ex.details) + '</div>' : '') + '</div>' + btn + '</li>';
  }).join('');
  $('exercise-count').textContent = required ? doneCount + '/' + required : '';

  $('today-list').innerHTML = ptEntryItems(todays, false);
}

// ── History ─────────────────────────────────────────────────────────────

function ptFmt(v) { return v === null || v === undefined ? '—' : (Math.round(v * 10) / 10).toString(); }

function ptRenderHistory() {
  var s = ptSummarize(pt.entries, ptToday(), pt.range);
  var mornings = s.days.filter(function (d) { return d.morningRight !== null; });
  var worse = mornings.map(function (d) { return Math.max(d.morningRight, d.morningLeft); });
  var avg = worse.length ? worse.reduce(function (a, b) { return a + b; }, 0) / worse.length : null;
  var flares = s.days.reduce(function (n, d) { return n + d.flares; }, 0);

  $('history-stats').innerHTML = [
    ['Avg morning pain', ptFmt(avg), 'worse knee, ' + mornings.length + ' mornings logged'],
    ['Flares', String(flares), 'in ' + pt.range + ' days'],
    ['Flares per day', ptFmt(s.lift.flaresPerLiftDay) + ' vs ' + ptFmt(s.lift.flaresPerOtherDay), 'lift days (' + s.lift.liftDays + ') vs other days'],
    ['Next-morning pain', ptFmt(s.lift.nextMorningAfterLift) + ' vs ' + ptFmt(s.lift.nextMorningAfterOther), 'after a lift day vs after other days'],
  ].map(function (t) {
    return '<div class="pt-stat"><div class="pt-stat-label">' + t[0] + '</div><div class="pt-stat-value">' + escapeHtml(t[1]) +
      '</div><div class="pt-stat-sub">' + escapeHtml(t[2]) + '</div></div>';
  }).join('');

  var width = Math.max(260, Math.round(($('pain-chart').clientWidth || 340)));
  $('pain-chart').innerHTML = ptPainChartSvg(s.days, width);
  $('flare-chart').innerHTML = ptFlareChartSvg(s.days, width);
  ptWireChartTips(s.days);

  var maxCount = s.triggers.length ? s.triggers[0].count : 0;
  $('trigger-bars').innerHTML = s.triggers.length ? s.triggers.map(function (t) {
    return '<div class="pt-tbar"><span class="pt-tbar-label">' + escapeHtml(t.label) + '</span>' +
      '<span class="pt-tbar-track"><span class="pt-tbar-fill" style="width:' + Math.round((t.count / maxCount) * 100) + '%"></span></span>' +
      '<span class="pt-tbar-count">' + t.count + '</span></div>';
  }).join('') : '<p class="pt-empty">No flares in this range.</p>';

  $('history-table').innerHTML = '<table><thead><tr><th>Date</th><th>R</th><th>L</th><th>Flares</th><th>Max</th><th>Lift</th><th>Ex.</th></tr></thead><tbody>' +
    s.days.slice().reverse().map(function (d) {
      return '<tr><td>' + d.date.slice(5) + '</td><td>' + ptFmt(d.morningRight) + '</td><td>' + ptFmt(d.morningLeft) + '</td><td>' + d.flares +
        '</td><td>' + ptFmt(d.maxFlare) + '</td><td>' + (d.lift ? escapeHtml(d.liftNotes || 'yes') : '') + '</td><td>' + (d.exercises || '') + '</td></tr>';
    }).join('') + '</tbody></table>';

  $('recent-list').innerHTML = ptEntryItems(pt.entries.slice(0, 40), true);
}

function ptWireChartTips(days) {
  var tip = $('chart-tip');
  var card = tip.parentNode;
  function show(e) {
    var hit = e.target.closest && e.target.closest('.pt-hit');
    if (!hit) return;
    var d = days[+hit.getAttribute('data-index')];
    tip.innerHTML = ptDayTipText(d).map(function (line, i) {
      return i === 0 ? '<strong>' + escapeHtml(line) + '</strong>' : '<div>' + escapeHtml(line) + '</div>';
    }).join('');
    tip.hidden = false;
    var cardBox = card.getBoundingClientRect();
    var box = hit.getBoundingClientRect();
    var left = box.left + box.width / 2 - cardBox.left - tip.offsetWidth / 2;
    tip.style.left = Math.max(4, Math.min(left, cardBox.width - tip.offsetWidth - 4)) + 'px';
    tip.style.top = (box.top - cardBox.top - tip.offsetHeight - 6 < 0 ? box.bottom - cardBox.top + 6 : box.top - cardBox.top - tip.offsetHeight - 6) + 'px';
    var cross = $('pt-crosshair');
    var x = +hit.getAttribute('x') + +hit.getAttribute('width') / 2;
    if (cross) {
      cross.setAttribute('x1', x);
      cross.setAttribute('x2', x);
      cross.setAttribute('visibility', 'visible');
    }
  }
  function hide() {
    tip.hidden = true;
    var cross = $('pt-crosshair');
    if (cross) cross.setAttribute('visibility', 'hidden');
  }
  ['pain-chart', 'flare-chart'].forEach(function (id) {
    var el = $(id);
    el.onpointermove = show;
    el.onclick = show;
    el.onpointerleave = function (e) { if (e.pointerType === 'mouse') hide(); };
  });
}

// ── Settings ────────────────────────────────────────────────────────────

function ptDaysHtml(days) {
  return '<div class="pt-days">' + PT_DAY_LETTERS.map(function (l, i) {
    var on = days.indexOf(i) !== -1;
    return '<button type="button" data-day="' + i + '" aria-pressed="' + on + '" class="' + (on ? 'selected' : '') + '">' + l + '</button>';
  }).join('') + '</div>';
}

function ptReadDays(container) {
  var out = [];
  var buttons = container.querySelectorAll('.pt-days button');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].classList.contains('selected')) out.push(+buttons[i].getAttribute('data-day'));
  }
  return out;
}

function ptExerciseRow(ex) {
  return '<div class="pt-edit-row" data-id="' + escapeHtml(ex.id || '') + '">' +
    '<input class="pt-input" name="name" placeholder="Exercise name" value="' + escapeHtml(ex.name || '') + '">' +
    '<input class="pt-input" name="details" placeholder="How (sets, cues)" value="' + escapeHtml(ex.details || '') + '">' +
    '<div class="pt-edit-line"><label><input type="checkbox" name="optional"' + (ex.optional ? ' checked' : '') + '> Optional</label>' +
    '<button type="button" class="pt-remove">Remove</button></div></div>';
}

function ptReminderRow(r) {
  return '<div class="pt-edit-row" data-id="' + escapeHtml(r.id || '') + '">' +
    '<input class="pt-input" name="label" placeholder="Reminder text" value="' + escapeHtml(r.label || '') + '">' +
    '<div class="pt-edit-line"><input class="pt-input pt-time" type="time" name="time" value="' + escapeHtml(r.time || '12:00') + '">' +
    '<label><input type="checkbox" name="enabled"' + (r.enabled !== false ? ' checked' : '') + '> On</label>' +
    '<button type="button" class="pt-remove">Remove</button></div>' +
    ptDaysHtml(r.days || [0, 1, 2, 3, 4, 5, 6]) + '</div>';
}

function ptRenderSettings() {
  var s = pt.settings;
  $('exercise-editor').innerHTML = s.exercises.map(ptExerciseRow).join('');
  $('reminder-editor').innerHTML = s.reminders.map(ptReminderRow).join('');
  var sit = s.sitting;
  $('sitting-editor').innerHTML =
    '<div class="pt-edit-line"><label><input type="checkbox" id="sit-enabled"' + (sit.enabled ? ' checked' : '') + '> Remind me to stand up</label></div>' +
    '<div class="pt-edit-line">every <input class="pt-input pt-num" type="number" min="15" max="240" step="5" id="sit-every" value="' + sit.every_minutes + '"> min</div>' +
    '<div class="pt-edit-line">from <input class="pt-input pt-time" type="time" id="sit-start" value="' + sit.start + '"> to ' +
    '<input class="pt-input pt-time" type="time" id="sit-end" value="' + sit.end + '"></div>' +
    '<div id="sit-days">' + ptDaysHtml(sit.days) + '</div>';
  var device = ptDeviceZone();
  $('tz-editor').innerHTML = '<div class="pt-edit-line"><input class="pt-input" id="tz-input" value="' + escapeHtml(s.timezone) + '">' +
    (device !== s.timezone ? '<button type="button" class="pt-ghost pt-inline" id="tz-device">Use ' + escapeHtml(device) + '</button>' : '') +
    '</div><p class="pt-hint">Reminders fire at these times in this zone.</p>';
  if ($('tz-device')) {
    $('tz-device').onclick = function () { $('tz-input').value = device; };
  }
}

function ptCollectSettings() {
  function rows(id) { return Array.prototype.slice.call($(id).querySelectorAll('.pt-edit-row')); }
  function val(row, name) { return row.querySelector('[name="' + name + '"]').value; }
  function checked(row, name) { return row.querySelector('[name="' + name + '"]').checked; }
  return {
    timezone: $('tz-input').value,
    exercises: rows('exercise-editor').map(function (r) {
      return { id: r.getAttribute('data-id') || null, name: val(r, 'name'), details: val(r, 'details'), optional: checked(r, 'optional') };
    }),
    reminders: rows('reminder-editor').map(function (r) {
      return { id: r.getAttribute('data-id') || null, label: val(r, 'label'), time: val(r, 'time'), enabled: checked(r, 'enabled'), days: ptReadDays(r) };
    }),
    sitting: {
      enabled: $('sit-enabled').checked,
      every_minutes: parseInt($('sit-every').value, 10),
      start: $('sit-start').value,
      end: $('sit-end').value,
      days: ptReadDays($('sit-days')),
    },
  };
}

function ptWireSettings() {
  $('tab-settings').addEventListener('click', function (e) {
    var day = e.target.closest('.pt-days button');
    if (day) {
      var on = !day.classList.contains('selected');
      day.classList.toggle('selected', on);
      day.setAttribute('aria-pressed', on);
      return;
    }
    var rm = e.target.closest('.pt-remove');
    if (rm) rm.closest('.pt-edit-row').remove();
  });
  $('add-exercise').addEventListener('click', function () {
    $('exercise-editor').insertAdjacentHTML('beforeend', ptExerciseRow({}));
    $('exercise-editor').lastElementChild.querySelector('input').focus();
  });
  $('add-reminder').addEventListener('click', function () {
    $('reminder-editor').insertAdjacentHTML('beforeend', ptReminderRow({}));
    $('reminder-editor').lastElementChild.querySelector('input').focus();
  });
  $('settings-save').addEventListener('click', function () {
    var next;
    try {
      next = ptNormalizeSettings(ptCollectSettings());
    } catch (err) {
      ptToast(err.message, null, true);
      return;
    }
    pt.store.saveSettings(next).then(function () {
      pt.settings = next;
      ptRenderAll();
      ptToast('Settings saved');
    }).catch(function (err) { ptToast('Settings not saved: ' + err.message, null, true); });
  });
  $('ics-download').addEventListener('click', function () {
    var blob = new Blob([ptBuildIcs(pt.settings, ptToday())], { type: 'text/calendar' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'knee-pt-reminders.ics';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
}

// ── Push ────────────────────────────────────────────────────────────────

function ptBase64ToBytes(b64) {
  var pad = '='.repeat((4 - (b64.length % 4)) % 4);
  var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function ptPushStatus(text, showButton) {
  $('push-status').textContent = text;
  $('push-enable').hidden = !showButton;
}

function ptSetupPush() {
  var isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (PT_DEMO) return ptPushStatus('Not available in demo mode.', false);
  if (!CONFIG.VAPID_PUBLIC_KEY) {
    return ptPushStatus('Not set up yet — the push sender needs VAPID keys (docs/pt-app.md). Use the calendar file meanwhile.', false);
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return ptPushStatus(isIos && !standalone
      ? 'On iPhone, add this page to your Home Screen first (Share → Add to Home Screen), then open it from there.'
      : 'This browser does not support push.', false);
  }
  if (Notification.permission === 'denied') {
    return ptPushStatus('Blocked for this app — allow notifications in Settings, then reopen.', false);
  }
  navigator.serviceWorker.ready.then(function (reg) {
    return reg.pushManager.getSubscription();
  }).then(function (sub) {
    if (sub) {
      // Re-save on every load so a renewed endpoint replaces the stale one.
      pt.store.savePushSubscription(sub.toJSON(), navigator.userAgent).catch(function () {});
      ptPushStatus('On for this device. Reminders are sent by the Brainy scheduler (up to 15 min late).', false);
    } else {
      ptPushStatus('Off for this device.', true);
    }
  });
}

function ptEnablePush() {
  Notification.requestPermission().then(function (perm) {
    if (perm !== 'granted') throw new Error('permission ' + perm);
    return navigator.serviceWorker.ready;
  }).then(function (reg) {
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: ptBase64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  }).then(function (sub) {
    return pt.store.savePushSubscription(sub.toJSON(), navigator.userAgent);
  }).then(function () {
    ptToast('Notifications on');
    ptSetupPush();
  }).catch(function (err) {
    ptToast('Could not enable notifications: ' + err.message, null, true);
  });
}

// ── Reminders while the app is open ─────────────────────────────────────

function ptRenderNextReminder() {
  var next = ptNextReminder(pt.settings, Date.now());
  if (!next) {
    $('next-reminder').textContent = '';
    return;
  }
  var when = next.date === ptLocalDate(Date.now(), pt.settings.timezone) ? next.time : PT_DAY_LETTERS[new Date(next.at).getDay()] + ' ' + next.time;
  $('next-reminder').textContent = 'Next: ' + next.label + ' · ' + when;
}

function ptTick() {
  var now = Date.now();
  var due = ptRemindersDue(pt.settings, pt.lastReminderCheck, now);
  pt.lastReminderCheck = now;
  if (due.length) {
    ptToast('⏰ ' + due[due.length - 1].label);
    if (navigator.vibrate) navigator.vibrate(200);
  }
  ptRenderNextReminder();
  if (ptLocalDate(now) !== pt._renderedDay) ptRenderAll();
}

// ── Tabs and start-up ───────────────────────────────────────────────────

function ptRenderAll() {
  pt._renderedDay = ptToday();
  ptRenderToday();
  if (!$('tab-history').hidden) ptRenderHistory();
  ptRenderNextReminder();
  var pending = pt.store.pendingCount();
  $('outbox-msg').hidden = !pending;
  $('outbox-msg').textContent = pending + ' entr' + (pending === 1 ? 'y is' : 'ies are') + ' waiting to sync.';
}

function ptShowTab(name) {
  ['today', 'history', 'settings'].forEach(function (t) {
    $('tab-' + t).hidden = t !== name;
  });
  var tabs = $('pt-tabs').querySelectorAll('button');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === name);
  if (name === 'history') ptRenderHistory();
  if (name === 'settings') ptRenderSettings();
  window.scrollTo(0, 0);
}

// Server rows plus anything still in the outbox (shown as "waiting to sync").
function ptReloadEntries() {
  var since = ptLocalDate(Date.now() - PT_HISTORY_DAYS * 86400000);
  return pt.store.listEntries(since).then(function (rows) {
    var queued = pt.store.pending().map(function (r) { return Object.assign({ queued: true }, r); });
    pt.entries = queued.concat(rows || []);
    ptRenderAll();
  });
}

function ptStart(baseStore) {
  pt.store = ptWithOutbox(baseStore, window.localStorage);
  $('auth-section').hidden = true;
  $('app-section').hidden = false;

  return pt.store.flush().then(function () {
    return pt.store.getSettings();
  }).then(function (stored) {
    pt.settings = ptNormalizeSettings(stored || Object.assign(ptDefaultSettings(), { timezone: ptDeviceZone() }));
    // First run: save the defaults so the push sender has a schedule to read.
    if (!stored) pt.store.saveSettings(pt.settings).catch(function () {});
    return ptReloadEntries();
  }).then(function () {
    ptSetupPush();
  }).catch(function (err) {
    pt.settings = pt.settings || ptNormalizeSettings(null);
    ptRenderAll();
    ptToast('Could not load: ' + err.message, null, true);
  });
}

function ptDemoSeed(store) {
  var now = Date.now();
  var triggers = ['sitting', 'car', 'car', 'stairs_down', 'after_lift', 'sitting'];
  var rows = [];
  for (var i = 29; i >= 1; i--) {
    var base = now - i * 86400000;
    var lift = [1, 3, 5].indexOf(new Date(base).getDay()) !== -1;
    var r = 3 + ((i * 7) % 4) - (i < 10 ? 1 : 0);
    rows.push(ptBuildEntry('morning', { pain_right: r, pain_left: Math.max(0, r - 2) }, base - 5 * 3600000));
    if (lift) rows.push(ptBuildEntry('lift', { lift_notes: 'light squats 3×5, deadlift' }, base));
    if (i % 3) rows.push(ptBuildEntry('exercise', { exercise_id: 'knee-extension-stretch', exercise_name: 'Standing knee extension stretch' }, base + 3600000));
    var flareCount = (lift ? 2 : 0) + (i % 4 === 0 ? 1 : 0);
    for (var f = 0; f < flareCount; f++) {
      rows.push(ptBuildEntry('flare', { pain: 4 + ((i + f) % 4), side: 'right', trigger: triggers[(i + f) % triggers.length] }, base + (f + 2) * 3600000));
    }
  }
  return rows.reduce(function (p, row) { return p.then(function () { return store.addEntry(row); }); }, Promise.resolve());
}

ptBuildScales();
ptWireForms();
ptWireSettings();
ptUpdateButtons();
$('push-enable').addEventListener('click', ptEnablePush);
$('pt-tabs').addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-tab]');
  if (btn) ptShowTab(btn.getAttribute('data-tab'));
});
setInterval(function () { if (pt.settings) ptTick(); }, 30000);
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && pt.settings) {
    pt.lastReminderCheck = Date.now();
    pt.store.flush().then(function (sent) {
      if (!sent) return ptRenderAll();
      ptToast(sent + ' queued entr' + (sent === 1 ? 'y' : 'ies') + ' synced');
      return ptReloadEntries();
    });
  }
});

if (PT_NO_CLIENT) {
  $('auth-section').hidden = false;
  $('auth-section').querySelector('p').textContent = 'Could not load the sign-in library — check your connection and reopen.';
  $('login-btn').hidden = true;
} else if (PT_DEMO) {
  $('demo-banner').hidden = false;
  $('logout-btn').hidden = true;
  var demoStore = ptLocalStore(window.localStorage);
  var seed = /[?&]demo=seed/.test(window.location.search);
  demoStore.listEntries('0000-01-01').then(function (rows) {
    return seed && !rows.length ? ptDemoSeed(demoStore) : null;
  }).then(function () { ptStart(demoStore); });
} else {
  var started = false;
  db.auth.onAuthStateChange(function (event, session) {
    if (session && !started) {
      started = true;
      ptStart(ptSupabaseStore(db, session.user.id));
    } else if (!session) {
      started = false;
      $('auth-section').hidden = false;
      $('app-section').hidden = true;
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
