// Tracker — pure logic for a generic symptom / rehab tracker. What's tracked
// (body areas, triggers, activities to compare, exercises, reminders) lives in
// each tracker's settings; knee PT is just a preset. Loaded as a plain script
// in the browser (every function is a global) and required by Node (the push
// sender and the CLI) through the module.exports at the bottom. No DOM, no network.

var TRK_KINDS = ['checkin', 'flare', 'activity', 'exercise'];
var TRK_MAX_AREAS = 4; // one validated chart colour per area
var TRK_ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
var TRK_DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Starting points for a new tracker. Everything in them is editable later.
var TRK_PRESETS = [
  {
    id: 'knee',
    label: 'Knee PT',
    settings: {
      title: 'Knee PT',
      checkin_label: 'Morning check-in',
      areas: [{ id: 'right', label: 'Right knee' }, { id: 'left', label: 'Left knee' }],
      triggers: [
        { label: 'Sat a long time' }, { label: 'Car' }, { label: 'Stairs down' },
        { label: 'After lifting' }, { label: 'After PT' }, { label: 'Other' },
      ],
      activities: [{ id: 'lift', label: 'Lift day', prompt: 'What did you lift? e.g. light squats 3×5, bench' }],
      exercises: [
        { id: 'knee-extension-stretch', name: 'Standing knee extension stretch', optional: false,
          details: 'Weight mostly on one leg, hand just above the knee pushing it straight. Both legs.' },
        { id: 'back-extensions', name: 'Back extensions', optional: false,
          details: 'Right after the stretch, to undo the lower-back strain.' },
        { id: 'wall-sit', name: 'Wall-sit / Spanish-squat holds', optional: true, details: '5 × 30–45 s.' },
        { id: 'hip-glute', name: 'Hip & glute circuit', optional: true,
          details: 'Non-lifting days: clamshells, side-lying leg raises, glute bridges, band walks.' },
      ],
      reminders: [
        { id: 'morning-check-in', label: 'Log morning knee pain', time: '07:30', days: TRK_ALL_DAYS },
        { id: 'pt-stretch', label: 'PT: knee extension stretch + back extensions', time: '12:30', days: TRK_ALL_DAYS },
      ],
      breaks: { enabled: true, label: 'Stand up & straighten your legs', every_minutes: 45, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
    },
  },
  {
    id: 'blank',
    label: 'Blank tracker',
    settings: {
      title: 'Tracker',
      areas: [{ label: 'Pain' }],
      triggers: [{ label: 'Sitting' }, { label: 'Exercise' }, { label: 'Other' }],
      activities: [],
      exercises: [],
      reminders: [{ label: 'Daily check-in', time: '08:00', days: TRK_ALL_DAYS }],
      breaks: { enabled: false, label: 'Get up and move', every_minutes: 45, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
    },
  },
];

function trkPresetSettings(id, timezone) {
  var preset = TRK_PRESETS.filter(function (p) { return p.id === id; })[0] || TRK_PRESETS[TRK_PRESETS.length - 1];
  var copy = JSON.parse(JSON.stringify(preset.settings));
  copy.timezone = timezone || 'UTC';
  return trkNormalizeSettings(copy);
}

// ── Small helpers ───────────────────────────────────────────────────────

function _pad(n) { return (n < 10 ? '0' : '') + n; }

function _text(v) {
  var s = typeof v === 'string' ? v.trim() : '';
  return s || null;
}

function trkSlug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
}

function _uniqueId(base, used) {
  var id = base;
  var n = 2;
  while (used[id]) id = base + '-' + n++;
  used[id] = true;
  return id;
}

function _byId(list, id) {
  return (list || []).filter(function (x) { return x.id === id; })[0] || null;
}

// ── Time ────────────────────────────────────────────────────────────────

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
function trkLocalDate(ms, tz) {
  var p = _zoneParts(ms, tz);
  return p.year + '-' + _pad(p.month) + '-' + _pad(p.day);
}

function _offsetMs(ms, tz) {
  var p = _zoneParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// Instant of wall-clock `hhmm` on `dateStr` in zone `tz`.
function trkZonedTimeToMs(dateStr, hhmm, tz) {
  var d = dateStr.split('-').map(Number);
  var t = hhmm.split(':').map(Number);
  var guess = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
  var ms = guess - _offsetMs(guess, tz);
  // Re-check once: the offset can differ on the far side of a DST change.
  return guess - _offsetMs(ms, tz);
}

function trkAddDays(dateStr, n) {
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

// ── Settings ────────────────────────────────────────────────────────────

function _time(v, field) {
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(field + ' time must be HH:MM (got "' + v + '")');
  return _pad(+m[1]) + ':' + m[2];
}

function _days(v) {
  if (!Array.isArray(v)) return TRK_ALL_DAYS.slice();
  return v.map(Number).filter(function (d, i, a) {
    return Number.isInteger(d) && d >= 0 && d <= 6 && a.indexOf(d) === i;
  }).sort();
}

// A list of { id, label, ...extra } items: ids are kept when given (so old
// entries stay linked after a rename) and otherwise slugged from the label.
function _labelled(list, what, extra) {
  var used = {};
  return (list || []).map(function (item) {
    var label = _text(item.label);
    if (!label) throw new Error('every ' + what + ' needs a label');
    var out = { id: _uniqueId(_text(item.id) || trkSlug(label), used), label: label };
    if (extra) extra(item, out);
    return out;
  });
}

// Validate a tracker's settings (throwing with a readable message) and fill
// in what's missing.
function trkNormalizeSettings(input) {
  input = input || {};

  var areas = _labelled(input.areas, 'area');
  if (!areas.length) throw new Error('add at least one area to track');
  if (areas.length > TRK_MAX_AREAS) throw new Error('track at most 4 areas (one chart line each)');

  var triggers = _labelled(input.triggers, 'trigger');
  if (!triggers.length) throw new Error('add at least one trigger');

  var activities = _labelled(input.activities, 'activity', function (a, out) {
    out.prompt = _text(a.prompt) || '';
  });

  var usedEx = {};
  var exercises = (input.exercises || []).map(function (e) {
    var name = _text(e.name);
    if (!name) throw new Error('every exercise needs a name');
    return { id: _uniqueId(_text(e.id) || trkSlug(name), usedEx), name: name, details: _text(e.details) || '', optional: !!e.optional };
  });

  var reminders = _labelled(input.reminders, 'reminder', function (r, out) {
    out.time = _time(r.time, 'reminder "' + out.label + '"');
    out.days = _days(r.days);
    out.enabled = r.enabled !== false;
  });

  var b = input.breaks || { enabled: false, every_minutes: 45, start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] };
  var every = Number(b.every_minutes);
  if (!Number.isInteger(every) || every < 15 || every > 240) {
    throw new Error('breaks every_minutes must be a whole number from 15 to 240');
  }
  var breaks = {
    enabled: !!b.enabled,
    label: _text(b.label) || 'Get up and move',
    every_minutes: every,
    start: _time(b.start, 'breaks start'),
    end: _time(b.end, 'breaks end'),
    days: _days(b.days),
  };
  if (_minutes(breaks.end) <= _minutes(breaks.start)) throw new Error('breaks end must be after start');

  return {
    title: _text(input.title) || 'Tracker',
    checkin_label: _text(input.checkin_label) || 'Morning check-in',
    timezone: _text(input.timezone) || 'UTC',
    areas: areas,
    triggers: triggers,
    activities: activities,
    exercises: exercises,
    reminders: reminders,
    breaks: breaks,
  };
}

// ── Entries ─────────────────────────────────────────────────────────────

function _score(v, what) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 10) {
    throw new Error(what + ' must be a whole number from 0 to 10');
  }
  return v;
}

// Validate a log entry against the tracker's settings and shape it as a
// brainy_tracker_entries row (minus user_id and tracker).
function trkBuildEntry(kind, fields, nowMs, settings, tz) {
  if (TRK_KINDS.indexOf(kind) === -1) throw new Error('unknown entry kind: ' + kind);
  fields = fields || {};
  var row = { kind: kind, occurred_at: new Date(nowMs).toISOString(), entry_date: trkLocalDate(nowMs, tz) };

  if (kind === 'checkin') {
    var scores = fields.scores || {};
    Object.keys(scores).forEach(function (id) {
      if (!_byId(settings.areas, id)) throw new Error('unknown area: ' + id);
    });
    row.scores = {};
    settings.areas.forEach(function (a) {
      if (scores[a.id] === undefined || scores[a.id] === null) throw new Error('score ' + a.label + ' too');
      row.scores[a.id] = _score(scores[a.id], a.label);
    });
  } else if (kind === 'flare') {
    row.pain = _score(fields.pain, 'pain');
    var area = fields.area || (settings.areas.length === 1 ? settings.areas[0].id : null);
    if (!(area === 'all' && settings.areas.length > 1) && !_byId(settings.areas, area)) {
      throw new Error('pick an area');
    }
    row.area = area;
    if (!_byId(settings.triggers, fields.trigger)) throw new Error('pick a trigger');
    row.trigger = fields.trigger;
  } else {
    var list = kind === 'activity' ? settings.activities : settings.exercises;
    var item = _byId(list, fields.item_id);
    if (!item) throw new Error('unknown ' + kind + ': ' + fields.item_id);
    row.item_id = item.id;
    row.item_label = item.label || item.name;
    var detail = _text(fields.detail);
    if (detail) row.detail = detail;
  }

  var note = _text(fields.note);
  if (note) row.note = note;
  return row;
}

// ── Reminder schedule ───────────────────────────────────────────────────

function _breakTimes(b) {
  var out = [];
  // The first break comes one interval after the start of the window.
  for (var m = _minutes(b.start) + b.every_minutes; m <= _minutes(b.end); m += b.every_minutes) out.push(_hhmm(m));
  return out;
}

// Every reminder that fires on local date `dateStr`, in time order.
function trkReminderTimes(settings, dateStr) {
  var wd = _weekday(dateStr);
  var out = [];
  settings.reminders.forEach(function (r) {
    if (r.enabled && r.days.indexOf(wd) !== -1) out.push({ id: r.id, label: r.label, time: r.time, kind: 'reminder' });
  });
  var b = settings.breaks;
  if (b.enabled && b.days.indexOf(wd) !== -1) {
    _breakTimes(b).forEach(function (t) { out.push({ id: 'break-' + t, label: b.label, time: t, kind: 'break' }); });
  }
  out.sort(function (a, c) { return a.time < c.time ? -1 : a.time > c.time ? 1 : 0; });
  return out;
}

// Reminders whose fire instant is in (fromMs, toMs]. Half-open so back-to-back
// windows (one per scheduler tick) never send the same reminder twice.
function trkRemindersDue(settings, fromMs, toMs) {
  var tz = settings.timezone;
  var due = [];
  var last = trkLocalDate(toMs, tz);
  for (var day = trkLocalDate(fromMs, tz); day <= last; day = trkAddDays(day, 1)) {
    trkReminderTimes(settings, day).forEach(function (r) {
      var at = trkZonedTimeToMs(day, r.time, tz);
      if (at > fromMs && at <= toMs) due.push({ id: r.id, label: r.label, kind: r.kind, time: r.time, date: day, at: at });
    });
  }
  return due;
}

function trkNextReminder(settings, nowMs) {
  var tz = settings.timezone;
  var start = trkLocalDate(nowMs, tz);
  for (var i = 0; i < 8; i++) {
    var day = trkAddDays(start, i);
    var times = trkReminderTimes(settings, day);
    for (var j = 0; j < times.length; j++) {
      var at = trkZonedTimeToMs(day, times[j].time, tz);
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
// counts, and for each activity a comparison of its days with the others.
function trkSummarize(entries, settings, today, days) {
  var byDate = {};
  var order = [];
  for (var i = days - 1; i >= 0; i--) {
    var date = trkAddDays(today, -i);
    var scores = {};
    settings.areas.forEach(function (a) { scores[a.id] = null; });
    byDate[date] = { date: date, scores: scores, worst: null, _checkinAt: null, flares: 0, maxFlare: null, activities: {}, exercises: 0 };
    order.push(date);
  }

  var triggerCounts = {};
  (entries || []).forEach(function (e) {
    var d = byDate[e.entry_date];
    if (!d) return;
    if (e.kind === 'checkin') {
      var at = e.occurred_at || '';
      if (d._checkinAt === null || at >= d._checkinAt) {
        d._checkinAt = at;
        settings.areas.forEach(function (a) {
          var v = e.scores ? e.scores[a.id] : undefined;
          d.scores[a.id] = v === undefined ? null : v;
        });
      }
    } else if (e.kind === 'flare') {
      d.flares++;
      d.maxFlare = d.maxFlare === null ? e.pain : Math.max(d.maxFlare, e.pain);
      triggerCounts[e.trigger] = (triggerCounts[e.trigger] || 0) + 1;
    } else if (e.kind === 'activity') {
      var prev = d.activities[e.item_id];
      d.activities[e.item_id] = prev ? (e.detail ? prev + '; ' + e.detail : prev) : (e.detail || '');
    } else if (e.kind === 'exercise') {
      d.exercises++;
    }
  });

  var rows = order.map(function (date) {
    var d = byDate[date];
    delete d._checkinAt;
    var vals = Object.keys(d.scores).map(function (k) { return d.scores[k]; }).filter(function (v) { return v !== null; });
    d.worst = vals.length ? Math.max.apply(null, vals) : null;
    return d;
  });

  var triggers = Object.keys(triggerCounts).map(function (id) {
    var t = _byId(settings.triggers, id);
    return { id: id, label: t ? t.label : id, count: triggerCounts[id] };
  }).sort(function (a, b) { return b.count - a.count; });

  var activities = settings.activities.map(function (act) {
    var on = [];
    var off = [];
    var after = [];
    var afterOther = [];
    rows.forEach(function (d, idx) {
      var did = Object.prototype.hasOwnProperty.call(d.activities, act.id);
      (did ? on : off).push(d.flares);
      var next = rows[idx + 1];
      if (next && next.worst !== null) (did ? after : afterOther).push(next.worst);
    });
    return {
      id: act.id,
      label: act.label,
      days: on.length,
      otherDays: off.length,
      flaresPerDay: _avg(on),
      flaresPerOtherDay: _avg(off),
      nextWorstAfter: _avg(after),
      nextWorstAfterOther: _avg(afterOther),
    };
  });

  return { days: rows, triggers: triggers, activities: activities };
}

// ── Calendar export (the no-server reminder option) ─────────────────────

function _icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// An iCalendar file with one weekly-recurring event + alarm per reminder
// time, starting on `startDate`. Importing it into the phone's Calendar gives
// reliable local alarms without push.
function trkBuildIcs(settings, startDate, trackerId) {
  var tz = settings.timezone;
  var uidBase = 'brainy-tracker-' + trkSlug(trackerId || settings.title);
  var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brainy//Tracker//EN', 'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:' + _icsText(settings.title)];

  function add(id, label, time, days) {
    if (!days.length) return;
    var hhmm = time.replace(':', '');
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + uidBase + '-' + id + '-' + hhmm + '@brainy',
      'DTSTAMP:' + stamp,
      'DTSTART;TZID=' + tz + ':' + startDate.replace(/-/g, '') + 'T' + hhmm + '00',
      'DURATION:PT5M',
      'RRULE:FREQ=WEEKLY;BYDAY=' + days.map(function (d) { return TRK_DAY_CODES[d]; }).join(','),
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

  settings.reminders.forEach(function (r) { if (r.enabled) add(r.id, r.label, r.time, r.days); });
  var b = settings.breaks;
  if (b.enabled) _breakTimes(b).forEach(function (t) { add('break', b.label, t, b.days); });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TRK_PRESETS: TRK_PRESETS,
    TRK_MAX_AREAS: TRK_MAX_AREAS,
    trkPresetSettings: trkPresetSettings,
    trkSlug: trkSlug,
    trkLocalDate: trkLocalDate,
    trkAddDays: trkAddDays,
    trkZonedTimeToMs: trkZonedTimeToMs,
    trkNormalizeSettings: trkNormalizeSettings,
    trkBuildEntry: trkBuildEntry,
    trkReminderTimes: trkReminderTimes,
    trkRemindersDue: trkRemindersDue,
    trkNextReminder: trkNextReminder,
    trkSummarize: trkSummarize,
    trkBuildIcs: trkBuildIcs,
  };
}
