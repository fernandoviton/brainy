// Knee PT — history charts as inline SVG. Two charts on one shared day axis
// (never a dual y-axis): morning pain per knee (0-10) with lift days shaded,
// and flare counts per day. Colours validated with the dataviz palette
// checker against the paper-white surface: right #C4652A, left #2F6FA8.

var PT_COLOR_RIGHT = '#C4652A';
var PT_COLOR_LEFT = '#2F6FA8';
var PT_COLOR_FLARE = '#6B5D4F';
var PT_SURFACE = '#FFFDF9';
var PT_GRID = '#E8E1D5';
var PT_LIFT_WASH = 'rgba(139, 154, 126, 0.18)';
var PT_PAD_LEFT = 22;
var PT_PAD_RIGHT = 34;

function _ptX(i, n, width) {
  var inner = width - PT_PAD_LEFT - PT_PAD_RIGHT;
  return PT_PAD_LEFT + (n === 1 ? inner / 2 : (i * inner) / (n - 1));
}

function _ptSlot(n, width) {
  return (width - PT_PAD_LEFT - PT_PAD_RIGHT) / Math.max(n - 1, 1);
}

// Path through the non-null values; a missing day breaks the line rather
// than drawing a misleading straight segment across it.
function _ptLinePath(values, n, width, y) {
  var d = '';
  var pen = false;
  values.forEach(function (v, i) {
    if (v === null || v === undefined) { pen = false; return; }
    d += (pen ? 'L' : 'M') + _ptX(i, n, width).toFixed(1) + ',' + y(v).toFixed(1);
    pen = true;
  });
  return d;
}

function ptPainChartSvg(days, width) {
  var n = days.length;
  var h = 170;
  var top = 10;
  var bottom = h - 22;
  var y = function (v) { return bottom - (v / 10) * (bottom - top); };
  var slot = _ptSlot(n, width);
  var parts = ['<svg viewBox="0 0 ' + width + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="Morning pain per knee, 0 to 10">'];

  days.forEach(function (d, i) {
    if (!d.lift) return;
    var w = Math.max(slot, 4);
    parts.push('<rect class="pt-lift" x="' + (_ptX(i, n, width) - w / 2).toFixed(1) + '" y="' + top + '" width="' + w.toFixed(1) +
      '" height="' + (bottom - top) + '" fill="' + PT_LIFT_WASH + '"/>');
  });

  [0, 5, 10].forEach(function (t) {
    parts.push('<line x1="' + PT_PAD_LEFT + '" x2="' + (width - PT_PAD_RIGHT) + '" y1="' + y(t) + '" y2="' + y(t) +
      '" stroke="' + PT_GRID + '" stroke-width="1"/>');
    parts.push('<text x="' + (PT_PAD_LEFT - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end" class="pt-axis">' + t + '</text>');
  });

  [0, n - 1].forEach(function (i) {
    if (n < 2 && i > 0) return;
    var dd = days[i].date.slice(5).replace('-', '/');
    parts.push('<text x="' + _ptX(i, n, width) + '" y="' + (h - 6) + '" text-anchor="' + (i === 0 ? 'start' : 'end') +
      '" class="pt-axis">' + dd + '</text>');
  });

  parts.push('<line id="pt-crosshair" x1="0" x2="0" y1="' + top + '" y2="' + bottom + '" stroke="#6B5D4F" stroke-width="1" visibility="hidden"/>');

  var series = [
    { key: 'morningRight', color: PT_COLOR_RIGHT, label: 'R' },
    { key: 'morningLeft', color: PT_COLOR_LEFT, label: 'L' },
  ];
  var showDots = n <= 31;
  series.forEach(function (s) {
    var values = days.map(function (d) { return d[s.key]; });
    parts.push('<path d="' + _ptLinePath(values, n, width, y) + '" fill="none" stroke="' + s.color +
      '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    values.forEach(function (v, i) {
      if (v === null) return;
      var isLast = values.slice(i + 1).every(function (x) { return x === null; });
      if (!showDots && !isLast) return;
      parts.push('<circle cx="' + _ptX(i, n, width).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="' + s.color +
        '" stroke="' + PT_SURFACE + '" stroke-width="2"/>');
    });
  });

  // Direct labels at the line ends, nudged apart when both knees end on the same value.
  var ends = series.map(function (s) {
    for (var i = n - 1; i >= 0; i--) if (days[i][s.key] !== null) return { s: s, i: i, v: days[i][s.key] };
    return null;
  }).filter(Boolean);
  if (ends.length === 2 && Math.abs(y(ends[0].v) - y(ends[1].v)) < 12) {
    var hi = ends[0].v >= ends[1].v ? 0 : 1;
    ends[hi].dy = -6;
    ends[1 - hi].dy = 8;
  }
  ends.forEach(function (e) {
    parts.push('<text x="' + (_ptX(e.i, n, width) + 8).toFixed(1) + '" y="' + (y(e.v) + 4 + (e.dy || 0)).toFixed(1) +
      '" class="pt-endlabel">' + e.s.label + ' ' + e.v + '</text>');
  });

  parts.push(_ptHitTargets(n, width, top, bottom));
  parts.push('</svg>');
  return parts.join('');
}

function ptFlareChartSvg(days, width) {
  var n = days.length;
  var h = 90;
  var top = 8;
  var bottom = h - 8;
  var max = Math.max(3, days.reduce(function (m, d) { return Math.max(m, d.flares); }, 0));
  var slot = _ptSlot(n, width);
  var bw = Math.max(2, Math.min(24, slot - 2));
  var parts = ['<svg viewBox="0 0 ' + width + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="Flares per day">'];

  [0, max].forEach(function (t) {
    var yy = bottom - (t / max) * (bottom - top);
    parts.push('<line x1="' + PT_PAD_LEFT + '" x2="' + (width - PT_PAD_RIGHT) + '" y1="' + yy + '" y2="' + yy +
      '" stroke="' + PT_GRID + '" stroke-width="1"/>');
    parts.push('<text x="' + (PT_PAD_LEFT - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="pt-axis">' + t + '</text>');
  });

  days.forEach(function (d, i) {
    if (!d.flares) return;
    var x = _ptX(i, n, width) - bw / 2;
    var bh = (d.flares / max) * (bottom - top);
    var r = Math.min(4, bw / 2, bh);
    // Rounded data-end, square at the baseline.
    parts.push('<path class="pt-bar" d="M' + x.toFixed(1) + ',' + bottom + 'V' + (bottom - bh + r).toFixed(1) +
      'Q' + x.toFixed(1) + ',' + (bottom - bh).toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + (bottom - bh).toFixed(1) +
      'H' + (x + bw - r).toFixed(1) +
      'Q' + (x + bw).toFixed(1) + ',' + (bottom - bh).toFixed(1) + ' ' + (x + bw).toFixed(1) + ',' + (bottom - bh + r).toFixed(1) +
      'V' + bottom + 'Z" fill="' + PT_COLOR_FLARE + '"/>');
  });

  parts.push(_ptHitTargets(n, width, top, bottom));
  parts.push('</svg>');
  return parts.join('');
}

// Invisible full-height column per day, wider than any mark, for hover/tap.
function _ptHitTargets(n, width, top, bottom) {
  var slot = Math.max(_ptSlot(n, width), 6);
  var out = '';
  for (var i = 0; i < n; i++) {
    out += '<rect class="pt-hit" data-index="' + i + '" x="' + (_ptX(i, n, width) - slot / 2).toFixed(1) + '" y="' + top +
      '" width="' + slot.toFixed(1) + '" height="' + (bottom - top) + '" fill="transparent"/>';
  }
  return out;
}

function ptDayTipText(d) {
  var bits = [d.date];
  bits.push(d.morningRight === null ? 'no morning log' : 'Morning R ' + d.morningRight + ' · L ' + d.morningLeft);
  bits.push(d.flares ? d.flares + ' flare' + (d.flares > 1 ? 's' : '') + ' (max ' + d.maxFlare + ')' : 'no flares');
  if (d.lift) bits.push('Lift' + (d.liftNotes ? ': ' + d.liftNotes : ''));
  if (d.exercises) bits.push(d.exercises + ' exercise' + (d.exercises > 1 ? 's' : '') + ' done');
  return bits;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ptPainChartSvg: ptPainChartSvg, ptFlareChartSvg: ptFlareChartSvg, ptDayTipText: ptDayTipText };
}
