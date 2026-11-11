// Knee PT — pure logic shared by the PWA (loaded as a plain script, so every
// function is a global) and by Node (the push sender and the CLI require it
// through the module.exports at the bottom). No DOM, no network.

var PT_TRIGGERS = [
  { id: 'sitting', label: 'Sat a long time' },
  { id: 'car', label: 'Car' },
  { id: 'stairs_down', label: 'Stairs down' },
  { id: 'after_lift', label: 'After lifting' },
  { id: 'after_pt', label: 'After PT' },
  { id: 'other', label: 'Other' },
];

var PT_SIDES = ['right', 'left', 'both'];
var PT_KINDS = ['morning', 'flare', 'lift', 'exercise'];
var PT_ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
var PT_DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
var PT_SITTING_LABEL = 'Stand up & straighten your legs';

function ptDefaultSettings() {
  return {
    timezone: 'America/Los_Angeles',
    exercises: [
      { id: 'knee-extension-stretch', name: 'Standing knee extension stretch', optional: false,
        details: 'Weight mostly on one leg, hand just above the knee pushing it straight. Both legs.' },
      { id: 'back-extensions', name: 'Back extensions', optional: false,
        details: 'Right after the stretch, to undo the lower-back strain.' },
      { id: 'wall-sit', name: 'Wall-sit / Spanish-squat holds', optional: true,
        details: '5 × 30–45 s.' },
      { id: 'hip-glute', name: 'Hip & glute circuit', optional: true,
        details: 'Non-lifting days: clamshells, side-lying leg raises, glute bridges, band walks.' },
    ],
    reminders: [
      { id: 'morning-check-in', label: 'Log morning knee pain', time: '07:30', days: PT_ALL_DAYS.slice(), enabled: true },
      { id: 'pt-stretch', label: 'PT: knee extension stretch + back extensions', time: '12:30', days: PT_ALL_DAYS.slice(), enabled: true },
    ],
    sitting: { enabled: true, every_minutes: 45, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  };
}

// ── Time ────────────────────────────────────────────────────────────────

function _pad(n) { return (n < 10 ? '0' : '') + n; }

var _fmtCache = {};
function _zoneParts(ms, tz) {
  var key = tz || '';
  if (!_fmtCache[key]) {
    _fmtCache[key] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  var out = {};
  _fmtCache[key].formatToParts(new Date(ms)).forEach(function (p) {
    if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
  });
  if (out.hour === 24) out.hour = 0;
  return out;
}

// 'YYYY-MM-DD' of instant `ms` in zone `tz` (device zone when omitted).
function ptLocalDate(ms, tz) {
  var p = _zoneParts(ms, tz);
  return p.year + '-' + _pad(p.month) + '-' + _pad(p.day);
}

function _offsetMs(ms, tz) {
  var p = _zoneParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// Instant of wall-clock `hhmm` on `dateStr` in zone `tz`.
function ptZonedTimeToMs(dateStr, hhmm, tz) {
  var d = dateStr.split('-').map(Number);
  var t = hhmm.split(':').map(Number);
  var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
  var ms = guess - _offsetMs(guess, tz);
  // Re-check once: the offset can differ on the far side of a DST change.
  return guess - _offsetMs(ms, tz);
}

function _addDays(dateStr, n) {
  var d = dateStr.split('-').map(Number);
  var x = new Date(Date.UTC(d[0], d[1] - 1, d[2] + n));
  return x.getUTCFullYear() + '-' + _pad(x.getUTCMonth() + 1) + '-' + _pad(x.getUTCDate());
}

function _weekday(dateStr) {
  var d = dateStr.split('-').map(Number);
  return new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay();
}

function _minutes(hhmm) {
  var t = hhmm.split(':').map(Number);
  return t[0] * 60 + t[1];
}

function _hhmm(mins) { return _pad(Math.floor(mins / 60)) + ':' + _pad(mins % 60); }

// ── Entries ─────────────────────────────────────────────────────────────

function _painValue(v, field) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10) {
    throw new Error(field + ' must be a whole number from 0 to 10');
  }
  return v;
}

function _text(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

// Validate a log entry and shape it as a brainy_pt_entries row (minus user_id).
function ptBuildEntry(kind, fields, nowMs, tz) {
  if (PT_KINDS.indexOf(kind) === -1) throw new Error('unknown entry kind: ' + kind);
  fields = fields || {};
  var row = { kind: kind, occurred_at: new Date(nowMs).toISOString(), entry_date: ptLocalDate(nowMs, tz) };

  if (kind === 'morning') {
    row.pain_right = _painValue(fields.pain_right, 'pain_right');
    row.pain_left = _painValue(fields.pain_left, 'pain_left');
  } else if (kind === 'flare') {
    row.pain = _painValue(fields.pain, 'pain');
    if (PT_SIDES.indexOf(fields.side) === -1) throw new Error('side must be one of ' + PT_SIDES.join(', '));
    row.side = fields.side;
    var known = PT_TRIGGERS.some(function (t) { return t.id === fields.trigger; });
    if (!known) throw new Error('trigger must be one of ' + PT_TRIGGERS.map(function (t) { return t.id; }).join(', '));
    row.trigger = fields.trigger;
  } else if (kind === 'lift') {
    var what = _text(fields.lift_notes);
    if (what) row.lift_notes = what;
  } else if (kind === 'exercise') {
    if (!_text(fields.exercise_id)) throw new Error('exercise_id is required');
    row.exercise_id = fields.exercise_id;
    var name = _text(fields.exercise_name);
    if (name) row.exercise_name = name;
  }

  var note = _text(fields.note);
  if (note) row.note = note;
  return row;
}

// ── Settings ────────────────────────────────────────────────────────────

function _slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function _time(v, field) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(field + ' time must be HH:MM (got "' + v + '")');
  return _pad(+m[1]) + ':' + m[2];
}

function _days(v) {
  if (!Array.isArray(v)) return PT_ALL_DAYS.slice();
  return v.map(Number).filter(function (d, i, a) {
    return Number.isInteger(d) && d >= 0 && d <= 6 && a.indexOf(d) === i;
  }).sort();
}

function _uniqueId(base, used) {
  var id = base;
  var n = 2;
  while (used[id]) id = base + '-' + n++;
  used[id] = true;
  return id;
}

// Validate settings (throwing on bad input) and fill in what's missing.
// `null` gives the defaults.
function ptNormalizeSettings(input) {
  var defaults = ptDefaultSettings();
  if (!input) return defaults;

  var usedEx = {};
  var exercises = (input.exercises || defaults.exercises).map(function (e) {
    var name = _text(e.name);
    if (!name) throw new Error('every exercise needs a name');
    return {
      id: _uniqueId(_text(e.id) || _slug(name), usedEx),
      name: name,
      details: _text(e.details) || '',
      optional: !!e.optional,
    };
  });

  var usedRem = {};
  var reminders = (input.reminders || defaults.reminders).map(function (r) {
    var label = _text(r.label);
    if (!label) throw new Error('every reminder needs a label');
    return {
      id: _uniqueId(_text(r.id) || _slug(label), usedRem),
      label: label,
      time: _time(r.time, 'reminder "' + label + '"'),
      days: _days(r.days),
      enabled: r.enabled !== false,
    };
  });

  var s = input.sitting || defaults.sitting;
  var every = Number(s.every_minutes);
  if (!Number.isInteger(every) || every < 15 || every > 240) {
    throw new Error('sitting every_minutes must be a whole number from 15 to 240');
  }
  var sitting = {
    enabled: !!s.enabled,
    every_minutes: every,
    start: _time(s.start, 'sitting start'),
    end: _time(s.end, 'sitting end'),
    days: _days(s.days),
  };
  if (_minutes(sitting.end) <= _minutes(sitting.start)) throw new Error('sitting end must be after start');

  return {
    timezone: _text(input.timezone) || defaults.timezone,
    exercises: exercises,
    reminders: reminders,
    sitting: sitting,
  };
}

// ── Reminder schedule ───────────────────────────────────────────────────

// Every reminder that fires on local date `dateStr`, in time order.
function ptReminderTimes(settings, dateStr) {
  var wd = _weekday(dateStr);
  var out = [];
  settings.reminders.forEach(function (r) {
    if (r.enabled && r.days.indexOf(wd) !== -1) {
      out.push({ id: r.id, label: r.label, time: r.time, kind: 'reminder' });
    }
  });
  var s = settings.sitting;
  if (s.enabled && s.days.indexOf(wd) !== -1) {
    // The first break comes one interval after the start of the sitting window.
    for (var m = _minutes(s.start) + s.every_minutes; m <= _minutes(s.end); m += s.every_minutes) {
      out.push({ id: 'sitting-' + _hhmm(m), label: PT_SITTING_LABEL, time: _hhmm(m), kind: 'sitting' });
    }
  }
  out.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
  return out;
}

// Reminders whose fire instant is in (fromMs, toMs]. Half-open so back-to-back
// windows (one per scheduler tick) never send the same reminder twice.
function ptRemindersDue(settings, fromMs, toMs) {
  var tz = settings.timezone;
  var due = [];
  var last = ptLocalDate(toMs, tz);
  for (var day = ptLocalDate(fromMs, tz); day <= last; day = _addDays(day, 1)) {
    ptReminderTimes(settings, day).forEach(function (r) {
      var at = ptZonedTimeToMs(day, r.time, tz);
      if (at > fromMs && at <= toMs) {
        due.push({ id: r.id, label: r.label, kind: r.kind, time: r.time, date: day, at: at });
      }
    });
  }
  return due;
}

function ptNextReminder(settings, nowMs) {
  var tz = settings.timezone;
  var start = ptLocalDate(nowMs, tz);
  for (var i = 0; i < 8; i++) {
    var day = _addDays(start, i);
    var times = ptReminderTimes(settings, day);
    for (var j = 0; j < times.length; j++) {
      var at = ptZonedTimeToMs(day, times[j].time, tz);
      if (at > nowMs) return { id: times[j].id, label: times[j].label, kind: times[j].kind, time: times[j].time, date: day, at: at };
    }
  }
  return null;
}

// ── History ─────────────────────────────────────────────────────────────

function _avg(list) {
  if (!list.length) return null;
  return list.reduce(function (a, b) { return a + b; }, 0) / list.length;
}

// Per-day rows for the `days` days ending on `today` (oldest first), trigger
// counts, and a lift-day vs other-day comparison.
function ptSummarize(entries, today, days) {
  var byDate = {};
  var order = [];
  for (var i = days - 1; i >= 0; i--) {
    var date = _addDays(today, -i);
    byDate[date] = {
      date: date, morningRight: null, morningLeft: null, _morningAt: '',
      flares: 0, maxFlare: null, lift: false, liftNotes: '', exercises: 0,
    };
    order.push(date);
  }

  var triggerCounts = {};
  (entries || []).forEach(function (e) {
    var d = byDate[e.entry_date];
    if (!d) return;
    if (e.kind === 'morning') {
      var at = e.occurred_at || '';
      if (d.morningRight === null || at >= d._morningAt) {
        d.morningRight = e.pain_right;
        d.morningLeft = e.pain_left;
        d._morningAt = at;
      }
    } else if (e.kind === 'flare') {
      d.flares++;
      d.maxFlare = d.maxFlare === null ? e.pain : Math.max(d.maxFlare, e.pain);
      triggerCounts[e.trigger] = (triggerCounts[e.trigger] || 0) + 1;
    } else if (e.kind === 'lift') {
      d.lift = true;
      if (e.lift_notes) d.liftNotes = d.liftNotes ? d.liftNotes + '; ' + e.lift_notes : e.lift_notes;
    } else if (e.kind === 'exercise') {
      d.exercises++;
    }
  });

  var rows = order.map(function (date) {
    var d = byDate[date];
    delete d._morningAt;
    return d;
  });

  var triggers = PT_TRIGGERS
    .map(function (t) { return { id: t.id, label: t.label, count: triggerCounts[t.id] || 0 }; })
    .filter(function (t) { return t.count > 0; })
    .sort(function (a, b) { return b.count - a.count; });

  var liftFlares = [];
  var otherFlares = [];
  var afterLift = [];
  var afterOther = [];
  rows.forEach(function (d, idx) {
    (d.lift ? liftFlares : otherFlares).push(d.flares);
    var next = rows[idx + 1];
    if (next && next.morningRight !== null) {
      (d.lift ? afterLift : afterOther).push(Math.max(next.morningRight, next.morningLeft));
    }
  });

  return {
    days: rows,
    triggers: triggers,
    lift: {
      liftDays: liftFlares.length,
      otherDays: otherFlares.length,
      flaresPerLiftDay: _avg(liftFlares),
      flaresPerOtherDay: _avg(otherFlares),
      nextMorningAfterLift: _avg(afterLift),
      nextMorningAfterOther: _avg(afterOther),
    },
  };
}

// ── Calendar export (the no-server reminder stopgap) ────────────────────

function _icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// An iCalendar file with one weekly-recurring event + alarm per reminder time,
// starting on `startDate`. Importing it into iOS Calendar gives reliable local
// alarms without push.
function ptBuildIcs(settings, startDate) {
  var tz = settings.timezone;
  var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brainy//Knee PT//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Knee PT'];

  function add(id, label, time, days) {
    if (!days.length) return;
    var hhmm = time.replace(':', '');
    var dtstart = startDate.replace(/-/g, '') + 'T' + hhmm + '00';
    lines.push(
      'BEGIN:VEVENT',
      'UID:brainy-pt-' + id + '-' + hhmm + '@brainy',
      'DTSTAMP:' + stamp,
      'DTSTART;TZID=' + tz + ':' + dtstart,
      'DURATION:PT5M',
      'RRULE:FREQ=WEEKLY;BYDAY=' + days.map(function (d) { return PT_DAY_CODES[d]; }).join(','),
      'SUMMARY:' + _icsText(label),
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:' + _icsText(label),
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  }

  settings.reminders.forEach(function (r) {
    if (r.enabled) add(r.id, r.label, r.time, r.days);
  });
  var s = settings.sitting;
  if (s.enabled) {
    for (var m = _minutes(s.start) + s.every_minutes; m <= _minutes(s.end); m += s.every_minutes) {
      add('sitting', PT_SITTING_LABEL, _hhmm(m), s.days);
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PT_TRIGGERS: PT_TRIGGERS,
    PT_SIDES: PT_SIDES,
    PT_SITTING_LABEL: PT_SITTING_LABEL,
    ptDefaultSettings: ptDefaultSettings,
    ptLocalDate: ptLocalDate,
    ptZonedTimeToMs: ptZonedTimeToMs,
    ptBuildEntry: ptBuildEntry,
    ptNormalizeSettings: ptNormalizeSettings,
    ptReminderTimes: ptReminderTimes,
    ptRemindersDue: ptRemindersDue,
    ptNextReminder: ptNextReminder,
    ptSummarize: ptSummarize,
    ptBuildIcs: ptBuildIcs,
  };
}
