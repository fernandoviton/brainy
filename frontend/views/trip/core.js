// Trip planner core: pure functions used by the page (window.PlannerCore) and
// by the tests (require). The plan is plain JSON stored in a Brainy knowledge
// entry; see frontend/views/trip/README.md for its shape.
(function (root) {
  var DECISION_STATUSES = ['open', 'leaning', 'decided', 'booked', 'dropped'];
  var OPTION_STATUSES = ['candidate', 'shortlisted', 'rejected'];
  var NUMERIC_SETTINGS = ['partySize', 'rooms', 'eurToUsd'];
  var LOG_LIMIT = 200;
  var TEXT_LIMIT = 4000;
  var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ── Dates (ISO yyyy-mm-dd, compared as strings, built in UTC) ──────────
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().substring(0, 10);
  }

  function weekday(iso) {
    return WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];
  }

  function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
  }

  // A base covers the nights from `from` up to (not including) `to`.
  function baseForNight(plan, iso) {
    var bases = plan.bases || [];
    for (var i = 0; i < bases.length; i++) {
      if (iso >= bases[i].from && iso < bases[i].to) return bases[i];
    }
    return null;
  }

  function tripDays(plan) {
    var out = [];
    var byDate = {};
    (plan.days || []).forEach(function (d) { byDate[d.date] = d; });
    if (!plan.trip || !plan.trip.start || !plan.trip.end) return out;
    for (var iso = plan.trip.start; iso <= plan.trip.end; iso = addDays(iso, 1)) {
      var day = byDate[iso] || {};
      out.push({ date: iso, weekday: weekday(iso), base: baseForNight(plan, iso), items: day.items || [], note: day.note || '' });
    }
    return out;
  }

  // Travelers are present from their `from` day through their `to` day.
  function travelersOn(plan, iso) {
    return (plan.travelers || []).filter(function (t) { return iso >= t.from && iso <= t.to; });
  }

  function headcount(plan, iso) {
    return travelersOn(plan, iso).reduce(function (n, t) { return n + (t.count || 1); }, 0);
  }

  // ── Options and costs ──────────────────────────────────────────────────
  function findDecision(plan, id) {
    var list = plan.decisions || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function findOption(decision, id) {
    var list = (decision && decision.options) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function netVotes(option) {
    var votes = option.votes || {};
    return Object.keys(votes).reduce(function (n, k) { return n + votes[k]; }, 0);
  }

  // The option the plan currently points at: chosen, else the most liked
  // (net votes > 0), else Brainy's recommendation. Rejected options never lead.
  function leadingOption(decision) {
    var options = (decision.options || []).filter(function (o) { return o.status !== 'rejected'; });
    var chosen = decision.chosen || [];
    for (var i = 0; i < chosen.length; i++) {
      var c = findOption(decision, chosen[i]);
      if (c) return c;
    }
    var best = null;
    options.forEach(function (o) {
      if (netVotes(o) > 0 && (!best || netVotes(o) > netVotes(best))) best = o;
    });
    if (best) return best;
    if (decision.recommended) {
      var rec = findOption(decision, decision.recommended);
      if (rec && rec.status !== 'rejected') return rec;
    }
    return null;
  }

  // What an option costs *our party*, in the option's currency.
  //   room-night × nights × rooms · person × people · group/vehicle × shareOfGroup
  //   party/total as-is
  function ourCost(option, decision, settings) {
    var cost = option && option.cost;
    if (!cost || typeof cost.low !== 'number') return null;
    decision = decision || {};
    settings = settings || {};
    var high = typeof cost.high === 'number' ? cost.high : cost.low;
    var factor = 1;
    switch (cost.unit) {
      case 'room-night':
        factor = (decision.nights || 1) * (decision.rooms || settings.rooms || 1);
        break;
      case 'person':
        factor = decision.people || settings.partySize || 1;
        break;
      case 'group':
      case 'vehicle':
        factor = typeof decision.shareOfGroup === 'number' ? decision.shareOfGroup : 1;
        break;
      default:
        factor = 1;
    }
    return { low: Math.round(cost.low * factor), high: Math.round(high * factor), currency: cost.currency || 'EUR' };
  }

  function toUsd(amount, currency, settings) {
    if (currency === 'USD') return amount;
    return amount * ((settings && settings.eurToUsd) || 1);
  }

  // Per budget category, in USD: `committed` sums chosen options; `projected`
  // sums chosen options, or the leading option where nothing is chosen yet.
  function budgetSummary(plan) {
    var settings = plan.settings || {};
    var categories = {};
    var uncosted = [];
    function bucket(name) {
      if (!categories[name]) categories[name] = { committed: { low: 0, high: 0 }, projected: { low: 0, high: 0 }, items: [] };
      return categories[name];
    }
    function add(range, cost) {
      range.low = Math.round(range.low + toUsd(cost.low, cost.currency, settings));
      range.high = Math.round(range.high + toUsd(cost.high, cost.currency, settings));
    }
    (plan.decisions || []).forEach(function (d) {
      if (d.status === 'dropped' || d.excludeFromBudget) return;
      var chosen = (d.chosen || []).map(function (id) { return findOption(d, id); }).filter(Boolean);
      var basis = chosen.length ? 'chosen' : 'leading';
      var picks = chosen.length ? chosen : [leadingOption(d)].filter(Boolean);
      var costed = false;
      picks.forEach(function (o) {
        var c = ourCost(o, d, settings);
        if (!c) return;
        costed = true;
        var b = bucket(o.budgetCategory || d.budgetCategory || d.category || 'other');
        if (basis === 'chosen') add(b.committed, c);
        add(b.projected, c);
        b.items.push({ decisionId: d.id, optionId: o.id, basis: basis, usdLow: Math.round(toUsd(c.low, c.currency, settings)), usdHigh: Math.round(toUsd(c.high, c.currency, settings)) });
      });
      if (!costed) uncosted.push({ id: d.id, title: d.title });
    });
    return { categories: categories, uncosted: uncosted };
  }

  // ── Scenarios: options that reshape the whole itinerary ────────────────
  // An option may carry `scenario: { bases, days }`. Viewing that option swaps
  // in its bases and replaces the plan's days on the dates it lists.
  function scenarioDecision(plan) {
    var list = plan.decisions || [];
    for (var i = 0; i < list.length; i++) {
      if ((list[i].options || []).some(function (o) { return o.scenario; })) return list[i];
    }
    return null;
  }

  // `optionId` defaults to the scenario decision's leading option.
  function withScenario(plan, optionId) {
    var d = scenarioDecision(plan);
    if (!d) return plan;
    var o = optionId ? findOption(d, optionId) : leadingOption(d);
    if (!o || !o.scenario) return plan;
    var view = {};
    Object.keys(plan).forEach(function (k) { view[k] = plan[k]; });
    if (o.scenario.bases) view.bases = o.scenario.bases;
    if (o.scenario.days) {
      var byDate = {};
      o.scenario.days.forEach(function (day) { byDate[day.date] = day; });
      view.days = (plan.days || []).map(function (day) { return byDate[day.date] || day; });
      o.scenario.days.forEach(function (day) {
        if (!view.days.some(function (x) { return x.date === day.date; })) view.days.push(day);
      });
    }
    return view;
  }

  // ── Ops (the only way the site changes the plan) ───────────────────────
  function fail(msg) { throw new Error(msg); }

  function requireDecision(plan, id) {
    return findDecision(plan, id) || fail('Unknown decision: ' + id);
  }

  function requireOption(decision, id) {
    return findOption(decision, id) || fail('Unknown option: ' + id + ' in decision ' + decision.id);
  }

  function cleanText(text, field) {
    var t = typeof text === 'string' ? text.trim() : '';
    if (!t) fail('Missing ' + field);
    if (t.length > TEXT_LIMIT) fail(field + ' is too long');
    return t;
  }

  function slug(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 40) || 'option';
  }

  function uniqueId(base, taken) {
    var id = base;
    for (var n = 2; taken.indexOf(id) !== -1; n++) id = base + '-' + n;
    return id;
  }

  function title(plan, decisionId, optionId) {
    var d = findDecision(plan, decisionId);
    var o = d && optionId ? findOption(d, optionId) : null;
    return (o ? o.title + ' (' + (d.title || d.id) + ')' : (d ? d.title || d.id : ''));
  }

  var OPS = {
    vote: function (plan, op) {
      var d = requireDecision(plan, op.decisionId);
      var o = requireOption(d, op.optionId);
      if ([1, 0, -1].indexOf(op.value) === -1) fail('Vote value must be 1, 0 or -1');
      o.votes = o.votes || {};
      if (op.value === 0) delete o.votes[op.who];
      else o.votes[op.who] = op.value;
      return (op.value === 1 ? 'liked ' : op.value === -1 ? 'disliked ' : 'cleared vote on ') + title(plan, d.id, o.id);
    },
    choose: function (plan, op) {
      var d = requireDecision(plan, op.decisionId);
      d.chosen = d.chosen || [];
      if (op.optionId === null || op.optionId === undefined) {
        d.chosen = [];
        if (d.status === 'decided') d.status = 'open';
        return 'un-decided ' + (d.title || d.id);
      }
      requireOption(d, op.optionId);
      if (d.multi) {
        var i = d.chosen.indexOf(op.optionId);
        if (i === -1) d.chosen.push(op.optionId);
        else d.chosen.splice(i, 1);
      } else {
        d.chosen = [op.optionId];
      }
      if (d.status !== 'booked') d.status = d.chosen.length ? 'decided' : 'open';
      return 'chose ' + title(plan, d.id, op.optionId);
    },
    setDecisionStatus: function (plan, op) {
      var d = requireDecision(plan, op.decisionId);
      if (DECISION_STATUSES.indexOf(op.status) === -1) fail('Invalid decision status: ' + op.status);
      d.status = op.status;
      return 'marked ' + (d.title || d.id) + ' ' + op.status;
    },
    setOptionStatus: function (plan, op) {
      var d = requireDecision(plan, op.decisionId);
      var o = requireOption(d, op.optionId);
      if (OPTION_STATUSES.indexOf(op.status) === -1) fail('Invalid option status: ' + op.status);
      o.status = op.status;
      if (op.status === 'rejected' && d.chosen) {
        d.chosen = d.chosen.filter(function (id) { return id !== o.id; });
        if (!d.chosen.length && d.status === 'decided') d.status = 'open';
      }
      return 'marked ' + title(plan, d.id, o.id) + ' ' + op.status;
    },
    comment: function (plan, op, now) {
      var text = cleanText(op.text, 'text');
      if (op.decisionId) requireDecision(plan, op.decisionId);
      if (op.optionId) requireOption(findDecision(plan, op.decisionId), op.optionId);
      plan.comments = plan.comments || [];
      var id = uniqueId('c' + now.replace(/\D/g, '').substring(0, 14), plan.comments.map(function (c) { return c.id; }));
      plan.comments.push({ id: id, decisionId: op.decisionId || null, optionId: op.optionId || null, who: op.who, text: text, at: now, resolved: false });
      return 'commented' + (op.decisionId ? ' on ' + title(plan, op.decisionId, op.optionId) : '');
    },
    resolveComment: function (plan, op) {
      var c = (plan.comments || []).filter(function (x) { return x.id === op.commentId; })[0] || fail('Unknown comment: ' + op.commentId);
      c.resolved = !c.resolved;
      return (c.resolved ? 'resolved' : 'reopened') + ' a comment';
    },
    addOption: function (plan, op) {
      var d = requireDecision(plan, op.decisionId);
      var t = cleanText(op.title, 'title');
      var option = {
        id: uniqueId(slug(t), (d.options || []).map(function (o) { return o.id; })),
        title: t,
        summary: typeof op.summary === 'string' ? op.summary.trim().substring(0, TEXT_LIMIT) : '',
        pros: [], cons: [], links: [], votes: {},
        status: 'candidate',
        addedBy: op.who,
      };
      if (op.url) {
        if (!/^https?:\/\//i.test(op.url)) fail('Option url must start with http(s)://');
        option.links.push({ label: 'Link', url: op.url });
      }
      d.options = d.options || [];
      d.options.push(option);
      return 'added option ' + t + ' to ' + (d.title || d.id);
    },
    toggleTask: function (plan, op) {
      var t = (plan.tasks || []).filter(function (x) { return x.id === op.taskId; })[0] || fail('Unknown task: ' + op.taskId);
      t.done = !t.done;
      return (t.done ? 'checked off ' : 'reopened ') + t.title;
    },
    setSetting: function (plan, op) {
      if (NUMERIC_SETTINGS.indexOf(op.key) === -1) fail('Unknown setting: ' + op.key);
      if (typeof op.value !== 'number' || !(op.value > 0)) fail('Invalid setting value for ' + op.key);
      plan.settings = plan.settings || {};
      plan.settings[op.key] = op.value;
      return 'set ' + op.key + ' to ' + op.value;
    },
  };

  // Returns a new plan with `op` applied; throws (leaving input untouched) on
  // any invalid op. `now` is an ISO timestamp.
  function applyOp(plan, op, now) {
    if (!op || !Object.prototype.hasOwnProperty.call(OPS, op.type)) fail('Unknown op: ' + (op && op.type));
    if (typeof op.who !== 'string' || !op.who.trim()) fail('Missing who');
    var next = clone(plan);
    var summary = OPS[op.type](next, op, now);
    next.log = [{ at: now, who: op.who, text: summary }].concat(next.log || []).slice(0, LOG_LIMIT);
    return next;
  }

  // ── Hash routing: #entry=<knowledge path>&tab=…|decision=…|research=… ──
  function parseHash(hash) {
    var out = {};
    String(hash || '').replace(/^#/, '').split('&').forEach(function (part) {
      var eq = part.indexOf('=');
      if (eq < 1) return;
      try {
        out[part.substring(0, eq)] = decodeURIComponent(part.substring(eq + 1));
      } catch (e) { /* malformed escape: ignore the pair */ }
    });
    return out;
  }

  function hashFor(params) {
    var keys = ['entry'].concat(Object.keys(params).filter(function (k) { return k !== 'entry'; }));
    var parts = keys.filter(function (k) { return params[k] !== null && params[k] !== undefined && params[k] !== ''; })
      .map(function (k) { return k + '=' + encodeURIComponent(params[k]).replace(/%2F/gi, '/'); });
    return '#' + parts.join('&');
  }

  // A trip folder is shorthand for its planner.md.
  function normalizeEntryPath(value) {
    var p = typeof value === 'string' ? value.trim() : '';
    if (!p) return null;
    return /\.md$/.test(p) ? p : p.replace(/\/+$/, '') + '/planner.md';
  }

  var api = {
    LOG_LIMIT: LOG_LIMIT,
    DECISION_STATUSES: DECISION_STATUSES,
    OPTION_STATUSES: OPTION_STATUSES,
    addDays: addDays,
    weekday: weekday,
    daysBetween: daysBetween,
    tripDays: tripDays,
    travelersOn: travelersOn,
    headcount: headcount,
    findDecision: findDecision,
    findOption: findOption,
    netVotes: netVotes,
    leadingOption: leadingOption,
    ourCost: ourCost,
    toUsd: toUsd,
    budgetSummary: budgetSummary,
    scenarioDecision: scenarioDecision,
    withScenario: withScenario,
    applyOp: applyOp,
    parseHash: parseHash,
    hashFor: hashFor,
    normalizeEntryPath: normalizeEntryPath,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlannerCore = api;
})(this);
