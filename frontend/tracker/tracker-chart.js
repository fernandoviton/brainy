// Tracker — history charts as inline SVG. Two charts on one shared day axis
// (never a dual y-axis): check-in score per area (0-10, one line each) with
// activity days shaded, and flare counts per day. Area colours are a fixed
// categorical order, validated with the dataviz palette checker against the
// paper-white surface (lightness, chroma, CVD separation, contrast).

var TRK_AREA_COLORS = ['#C4652A', '#2F6FA8', '#3F8A4E', '#9A4F9E'];
var TRK_COLOR_FLARE = '#6B5D4F';
var TRK_SURFACE = '#FFFDF9';
var TRK_GRID = '#E8E1D5';
var TRK_LIFT_WASH = 'rgba(139, 154, 126, 0.18)';
var TRK_PAD_LEFT = 22;
var TRK_PAD_RIGHT = 34;

function _trkX(i, n, width) {
  var inner = width - TRK_PAD_LEFT - TRK_PAD_RIGHT;
  return TRK_PAD_LEFT + (n === 1 ? inner / 2 : (i * inner) / (n - 1));
}

function _trkSlot(n, width) {
  return (width - TRK_PAD_LEFT - TRK_PAD_RIGHT) / Math.max(n - 1, 1);
}

// Path through the non-null values; a missing day breaks the line rather
// than drawing a misleading straight segment across it.
function _trkLinePath(values, n, width, y) {
  var d = '';
  var pen = false;
  values.forEach(function (v, i) {
    if (v === null || v === undefined) { pen = false; return; }
    d += (pen ? 'L' : 'M') + _trkX(i, n, width).toFixed(1) + ',' + y(v).toFixed(1);
    pen = true;
  });
  return d;
}

function trkCheckinChartSvg(days, areas, width) {
  var n = days.length;
  var h = 170;
  var top = 10;
  var bottom = h - 22;
  var y = function (v) { return bottom - (v / 10) * (bottom - top); };
  var slot = _trkSlot(n, width);
  var parts = ['<svg viewBox="0 0 ' + width + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="Check-in score per area, 0 to 10">'];

  days.forEach(function (d, i) {
    if (!Object.keys(d.activities).length) return;
    var w = Math.max(slot, 4);
    parts.push('<rect class="trk-activity" x="' + (_trkX(i, n, width) - w / 2).toFixed(1) + '" y="' + top + '" width="' + w.toFixed(1) +
      '" height="' + (bottom - top) + '" fill="' + TRK_LIFT_WASH + '"/>');
  });

  [0, 5, 10].forEach(function (t) {
    parts.push('<line x1="' + TRK_PAD_LEFT + '" x2="' + (width - TRK_PAD_RIGHT) + '" y1="' + y(t) + '" y2="' + y(t) +
      '" stroke="' + TRK_GRID + '" stroke-width="1"/>');
    parts.push('<text x="' + (TRK_PAD_LEFT - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end" class="trk-axis">' + t + '</text>');
  });

  [0, n - 1].forEach(function (i) {
    if (n < 2 && i > 0) return;
    var dd = days[i].date.slice(5).replace('-', '/');
    parts.push('<text x="' + _trkX(i, n, width) + '" y="' + (h - 6) + '" text-anchor="' + (i === 0 ? 'start' : 'end') +
      '" class="trk-axis">' + dd + '</text>');
  });

  parts.push('<line id="trk-crosshair" x1="0" x2="0" y1="' + top + '" y2="' + bottom + '" stroke="#6B5D4F" stroke-width="1" visibility="hidden"/>');

  var series = areas.slice(0, TRK_AREA_COLORS.length).map(function (a, i) {
    return { key: a.id, color: TRK_AREA_COLORS[i], label: a.label.split(/\s+/)[0] };
  });
  var showDots = n <= 31;
  series.forEach(function (s) {
    var values = days.map(function (d) { return d.scores[s.key]; });
    parts.push('<path d="' + _trkLinePath(values, n, width, y) + '" fill="none" stroke="' + s.color +
      '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    values.forEach(function (v, i) {
      if (v === null) return;
      var isLast = values.slice(i + 1).every(function (x) { return x === null; });
      if (!showDots && !isLast) return;
      parts.push('<circle cx="' + _trkX(i, n, width).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="' + s.color +
        '" stroke="' + TRK_SURFACE + '" stroke-width="2"/>');
    });
  });

  // Direct labels at the line ends, spread apart vertically so equal values don't collide.
  var ends = series.map(function (s) {
    for (var i = n - 1; i >= 0; i--) if (days[i].scores[s.key] !== null) return { s: s, i: i, v: days[i].scores[s.key] };
    return null;
  }).filter(Boolean);
  ends.sort(function (a, b) { return y(a.v) - y(b.v); });
  var lastY = -Infinity;
  ends.forEach(function (e) {
    var want = y(e.v) + 4;
    var at = Math.max(want, lastY + 12);
    e.dy = at - want;
    lastY = at;
  });
  ends.forEach(function (e) {
    parts.push('<text x="' + (_trkX(e.i, n, width) + 8).toFixed(1) + '" y="' + (y(e.v) + 4 + (e.dy || 0)).toFixed(1) +
      '" class="trk-endlabel">' + e.s.label + ' ' + e.v + '</text>');
  });

  parts.push(_trkHitTargets(n, width, top, bottom));
  parts.push('</svg>');
  return parts.join('');
}

function trkFlareChartSvg(days, width) {
  var n = days.length;
  var h = 90;
  var top = 8;
  var bottom = h - 8;
  var max = Math.max(3, days.reduce(function (m, d) { return Math.max(m, d.flares); }, 0));
  var slot = _trkSlot(n, width);
  var bw = Math.max(2, Math.min(24, slot - 2));
  var parts = ['<svg viewBox="0 0 ' + width + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="Flares per day">'];

  [0, max].forEach(function (t) {
    var yy = bottom - (t / max) * (bottom - top);
    parts.push('<line x1="' + TRK_PAD_LEFT + '" x2="' + (width - TRK_PAD_RIGHT) + '" y1="' + yy + '" y2="' + yy +
      '" stroke="' + TRK_GRID + '" stroke-width="1"/>');
    parts.push('<text x="' + (TRK_PAD_LEFT - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="trk-axis">' + t + '</text>');
  });

  days.forEach(function (d, i) {
    if (!d.flares) return;
    var x = _trkX(i, n, width) - bw / 2;
    var bh = (d.flares / max) * (bottom - top);
    var r = Math.min(4, bw / 2, bh);
    // Rounded data-end, square at the baseline.
    parts.push('<path class="trk-bar" d="M' + x.toFixed(1) + ',' + bottom + 'V' + (bottom - bh + r).toFixed(1) +
      'Q' + x.toFixed(1) + ',' + (bottom - bh).toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + (bottom - bh).toFixed(1) +
      'H' + (x + bw - r).toFixed(1) +
      'Q' + (x + bw).toFixed(1) + ',' + (bottom - bh).toFixed(1) + ' ' + (x + bw).toFixed(1) + ',' + (bottom - bh + r).toFixed(1) +
      'V' + bottom + 'Z" fill="' + TRK_COLOR_FLARE + '"/>');
  });

  parts.push(_trkHitTargets(n, width, top, bottom));
  parts.push('</svg>');
  return parts.join('');
}

// Invisible full-height column per day, wider than any mark, for hover/tap.
function _trkHitTargets(n, width, top, bottom) {
  var slot = Math.max(_trkSlot(n, width), 6);
  var out = '';
  for (var i = 0; i < n; i++) {
    out += '<rect class="trk-hit" data-index="' + i + '" x="' + (_trkX(i, n, width) - slot / 2).toFixed(1) + '" y="' + top +
      '" width="' + slot.toFixed(1) + '" height="' + (bottom - top) + '" fill="transparent"/>';
  }
  return out;
}

function trkDayTipText(d, settings) {
  var bits = [d.date];
  var scored = settings.areas.filter(function (a) { return d.scores[a.id] !== null && d.scores[a.id] !== undefined; });
  bits.push(scored.length ? scored.map(function (a) { return a.label + ' ' + d.scores[a.id]; }).join(' · ') : 'no check-in');
  bits.push(d.flares ? d.flares + ' flare' + (d.flares > 1 ? 's' : '') + ' (max ' + d.maxFlare + ')' : 'no flares');
  Object.keys(d.activities).forEach(function (id) {
    var act = settings.activities.filter(function (a) { return a.id === id; })[0];
    bits.push((act ? act.label : id) + (d.activities[id] ? ': ' + d.activities[id] : ''));
  });
  if (d.exercises) bits.push(d.exercises + ' exercise' + (d.exercises > 1 ? 's' : '') + ' done');
  return bits;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TRK_AREA_COLORS: TRK_AREA_COLORS, trkCheckinChartSvg: trkCheckinChartSvg, trkFlareChartSvg: trkFlareChartSvg, trkDayTipText: trkDayTipText };
}
