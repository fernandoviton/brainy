/**
 * Minimal 5-field cron evaluator (minute hour day-of-month month day-of-week),
 * evaluated in the process's local timezone, like crontab.
 *
 * Supports `*`, lists (`1,15`), ranges (`9-17`), steps (`*\/15`, `8-18/5`),
 * month/day names (`jan`, `mon`), day-of-week 7 = Sunday, and the @ macros.
 * When both day-of-month and day-of-week are restricted, either may match
 * (the standard cron OR rule).
 */

const MACROS = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS, nameBase: 1 },
  { name: 'day-of-week', min: 0, max: 7, names: DAYS, nameBase: 0 },
];

function parseValue(token, field, expr) {
  const lower = token.toLowerCase();
  if (field.names && field.names.includes(lower)) {
    return field.names.indexOf(lower) + field.nameBase;
  }
  if (!/^\d+$/.test(token)) {
    throw new Error(`invalid ${field.name} value "${token}" in cron "${expr}"`);
  }
  const n = Number(token);
  if (n < field.min || n > field.max) {
    throw new Error(`${field.name} value ${n} out of range ${field.min}-${field.max} in cron "${expr}"`);
  }
  return n;
}

function parseField(text, field, expr) {
  const values = new Set();
  for (const part of text.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) === 0) {
        throw new Error(`invalid step "/${stepPart}" in ${field.name} of cron "${expr}"`);
      }
      step = Number(stepPart);
    }
    let lo;
    let hi;
    if (rangePart === '*') {
      lo = field.min;
      hi = field.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      lo = parseValue(a, field, expr);
      hi = parseValue(b, field, expr);
      if (lo > hi) throw new Error(`invalid range "${rangePart}" in ${field.name} of cron "${expr}"`);
    } else {
      lo = parseValue(rangePart, field, expr);
      hi = stepPart !== undefined ? field.max : lo;
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

function parseCron(expr) {
  let text = String(expr || '').trim();
  if (text.startsWith('@')) {
    if (!MACROS[text.toLowerCase()]) throw new Error(`unknown macro "${text}" in cron`);
    text = MACROS[text.toLowerCase()];
  }
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length !== 5) {
    throw new Error(`invalid cron "${expr}": expected 5 fields (minute hour day-of-month month day-of-week)`);
  }
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i], expr));
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*',
  };
}

function dayMatches(c, d) {
  const domOk = c.dom.has(d.getDate());
  const dowOk = c.dow.has(d.getDay());
  if (c.domRestricted && c.dowRestricted) return domOk || dowOk;
  if (c.domRestricted) return domOk;
  if (c.dowRestricted) return dowOk;
  return true;
}

// First fire time strictly after `after` (a Date). Walks month -> day -> hour ->
// minute, jumping whole units when the coarser field doesn't match, so even a
// yearly expression resolves in a few hundred steps.
function nextFire(expr, after) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const limit = after.getTime() + 5 * 366 * 24 * 3600e3;
  while (d.getTime() <= limit) {
    if (!c.month.has(d.getMonth() + 1)) {
      d.setMonth(d.getMonth() + 1, 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(c, d)) {
      d.setDate(d.getDate() + 1);
      d.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hour.has(d.getHours())) {
      d.setHours(d.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minute.has(d.getMinutes())) {
      d.setMinutes(d.getMinutes() + 1, 0, 0);
      continue;
    }
    return d;
  }
  throw new Error(`cron "${typeof expr === 'string' ? expr : '(parsed)'}" has no fire time in the next 5 years`);
}

// Longest gap between consecutive fires over the next `samples` fires. Used to
// derive a starvation threshold: a weekday-only job legitimately goes 72h
// without running over a weekend.
function maxGapMs(expr, from, samples = 14) {
  const c = typeof expr === 'string' ? parseCron(expr) : expr;
  let prev = nextFire(c, from);
  let max = 0;
  for (let i = 0; i < samples; i++) {
    const next = nextFire(c, prev);
    max = Math.max(max, next.getTime() - prev.getTime());
    prev = next;
  }
  return max;
}

module.exports = { parseCron, nextFire, maxGapMs };
