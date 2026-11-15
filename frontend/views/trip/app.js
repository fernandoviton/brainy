/* global PlannerCore, EntryStore, MockClient, PlannerFixture, CONFIG, supabase, L, marked, DOMPurify */
// Trip planner UI over the knowledge entry named in the URL hash
// (#entry=<trip>/planner.md). The page reads and writes that entry directly
// with the signed-in Supabase client, through entry-store.js; every change is
// an op (core.applyOp). On localhost with no Supabase config it runs in mock
// mode against the fake fixture. Rendering is plain DOM.
(function () {
  var C = PlannerCore;
  var STASH_KEY = 'planner.entry'; // survives the OAuth round trip, which drops the hash
  var store = null;
  var entryPath = null;
  var plan = null;
  var tab = 'overview';
  var map = null;
  var ui = {
    decisionFilter: 'active',
    decisionCategory: 'all',
    decisionSearch: '',
    hideRejected: true,
    showAlternatives: false,
    mapLayers: {},
    researchPath: null,
  };

  var STATUS_LABEL = { open: 'Open', leaning: 'Leaning', decided: 'Decided', booked: 'Booked', dropped: 'Dropped' };
  var CATEGORY_LABEL = { lodging: 'Lodging', transport: 'Getting around', activity: 'Activities', food: 'Food & wine', strategy: 'Strategy' };
  var BUDGET_LABEL = { lodging: 'Lodging', transport: 'Drivers & trains', guides: 'Guides & tours', tickets: 'Tickets', activities: 'Activities & classes', food: 'Food & wine', other: 'Other' };
  var SLOT_LABEL = { travel: 'Travel', am: 'Morning', pm: 'Afternoon', eve: 'Evening', day: 'All day' };
  var SLOT_ORDER = ['travel', 'day', 'am', 'pm', 'eve'];

  // ── DOM helpers ────────────────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.substring(0, 2) === 'on') el.addEventListener(k.substring(2), v);
        else if (k === 'html') el.innerHTML = v; // only ever sanitized markdown
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function safeUrl(url) {
    return /^https?:\/\//i.test(url || '') ? url : null;
  }

  function extLink(link) {
    var url = safeUrl(link.url);
    if (!url) return null;
    return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, link.label || url);
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      return h('div', { class: 'md', html: DOMPurify.sanitize(marked.parse(text || '')) });
    }
    return h('pre', { class: 'md' }, text || '');
  }

  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = isError ? 'error' : '';
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, isError ? 6000 : 2200);
  }

  // ── Formatting ─────────────────────────────────────────────────────────
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso, withWeekday) {
    if (!iso) return '';
    var p = iso.split('-');
    var s = MONTHS[Number(p[1]) - 1] + ' ' + Number(p[2]);
    return withWeekday ? C.weekday(iso) + ' ' + s : s;
  }
  function fmtDates(list) {
    if (!list || !list.length) return '';
    if (list.length === 1) return fmtDate(list[0], true);
    return fmtDate(list[0]) + ' – ' + fmtDate(list[list.length - 1]);
  }
  function money(n, currency) {
    var sym = currency === 'USD' ? '$' : '€';
    return sym + Math.round(n).toLocaleString('en-US');
  }
  function range(low, high, currency) {
    if (low === high) return money(low, currency);
    return money(low, currency) + '–' + money(high, currency).replace(/^[€$]/, '');
  }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function relDays(iso) {
    var n = C.daysBetween(todayIso(), iso);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? 'in ' + n + ' days' : Math.abs(n) + ' days ago';
  }
  function timeAgo(iso) {
    var mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    if (mins < 1440) return Math.round(mins / 60) + 'h ago';
    return fmtDate(iso.substring(0, 10));
  }

  // ── Hash links: always carry #entry=… so every link stays on this trip ─
  function link(params) {
    return C.hashFor(Object.assign({ entry: entryPath }, params));
  }
  // The hash params that put you back on the current tab.
  function tabParams() {
    if (tab === 'research' && ui.researchPath) return { research: ui.researchPath };
    return { tab: tab === 'overview' ? null : tab };
  }
  function setTabLinks() {
    var links = document.querySelectorAll('#tabs a');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', link({ tab: links[i].getAttribute('data-tab') }));
  }

  // ── Data access ────────────────────────────────────────────────────────
  function who() {
    return localStorage.getItem('planner.who') || ((plan.settings && plan.settings.people) || ['Me'])[0];
  }

  function showMessage(title, detail, hint) {
    var v = document.getElementById('view');
    v.innerHTML = '';
    v.appendChild(h('div', { class: 'card error' }, h('h2', null, title), h('p', null, detail), hint ? h('p', { class: 'muted' }, hint) : null));
  }

  function load() {
    var path = entryPath;
    document.getElementById('trip-sub').textContent = path;
    return store.load(path).then(function (entry) {
      if (path !== entryPath) return; // switched trips while loading
      plan = entry.plan;
      setupWho();
      render();
    }).catch(function (e) {
      plan = null;
      showMessage('Could not load the plan', e.message, 'Check the #entry= path, and that you are signed in as the entry\'s owner.');
    });
  }

  function op(payload) {
    payload.who = who();
    return store.applyOp(entryPath, payload).then(function (result) {
      plan = result.plan;
      render();
      refreshDrawer();
      return plan;
    }).catch(function (e) {
      toast('Not saved: ' + e.message, true);
      throw e;
    });
  }

  function setupWho() {
    var sel = document.getElementById('who-select');
    sel.innerHTML = '';
    ((plan.settings && plan.settings.people) || ['Me']).forEach(function (p) {
      sel.appendChild(h('option', { value: p, selected: p === who() }, p));
    });
    sel.onchange = function () { localStorage.setItem('planner.who', sel.value); render(); refreshDrawer(); };
  }

  function decisionById(id) { return C.findDecision(plan, id); }

  // The plan as seen under the itinerary version being viewed (default: the
  // leading option of the scenario decision, e.g. Plan A vs Plan B).
  function viewPlan() { return C.withScenario(plan, ui.scenario); }

  function scenarioSwitcher() {
    var d = C.scenarioDecision(plan);
    if (!d) return null;
    var lead = C.leadingOption(d);
    var current = ui.scenario || (lead && lead.id);
    return h('div', { class: 'scenario-bar' },
      h('span', { class: 'small' }, 'Itinerary version: '),
      segmented(activeOptions(d).map(function (o) {
        return [o.id, (o.short || o.title) + (isChosen(d, o) ? ' ✓' : lead && lead.id === o.id ? ' ★' : '')];
      }), current, function (val) { ui.scenario = val; render(); }),
      h('span', { class: 'muted small' }, ' ', openDecisionLink(d.id, 'compare & decide →')));
  }
  function commentsFor(decisionId, optionId) {
    return (plan.comments || []).filter(function (c) {
      return c.decisionId === decisionId && (optionId === undefined || c.optionId === optionId);
    });
  }
  function activeOptions(d) {
    return (d.options || []).filter(function (o) { return o.status !== 'rejected'; });
  }
  function isChosen(d, o) { return (d.chosen || []).indexOf(o.id) !== -1; }

  // ── Small shared widgets ───────────────────────────────────────────────
  function statusPill(status) {
    return h('span', { class: 'pill status-' + status }, STATUS_LABEL[status] || status);
  }
  function basePill(base) {
    if (!base) return h('span', { class: 'pill base-none' }, '✈︎ in transit');
    return h('span', { class: 'pill', style: 'background:' + base.color + ';color:#fff' }, base.name);
  }
  function voteSummary(o) {
    var votes = o.votes || {};
    var names = Object.keys(votes);
    if (!names.length) return null;
    return h('span', { class: 'votes' }, names.map(function (n) {
      return h('span', { class: 'vote ' + (votes[n] > 0 ? 'up' : 'down'), title: n + (votes[n] > 0 ? ' likes this' : ' is not keen') },
        (votes[n] > 0 ? '👍 ' : '👎 ') + n);
    }));
  }
  function costLine(o, d) {
    var c = C.ourCost(o, d, plan.settings);
    if (!c) return o.cost && o.cost.note ? h('span', { class: 'muted' }, o.cost.note) : h('span', { class: 'muted' }, 'cost unknown');
    var usd = h('span', { class: 'muted' }, ' ≈ ' + range(C.toUsd(c.low, c.currency, plan.settings), C.toUsd(c.high, c.currency, plan.settings), 'USD'));
    return h('span', null, h('strong', null, range(c.low, c.high, c.currency)), c.currency === 'USD' ? null : usd, h('span', { class: 'muted' }, ' our share'));
  }
  function decisionProgress(d) {
    var opts = activeOptions(d);
    var me = who();
    var mine = opts.filter(function (o) { return o.votes && o.votes[me]; }).length;
    return opts.length + ' option' + (opts.length === 1 ? '' : 's') + (opts.length ? ' · you reacted to ' + mine : '');
  }
  function openDecisionLink(id, label) {
    return h('a', { href: link(Object.assign(tabParams(), { decision: id })), class: 'dlink' }, label);
  }

  // ── Render dispatch ────────────────────────────────────────────────────
  function render() {
    if (!plan) return;
    document.getElementById('trip-title').textContent = (plan.trip && plan.trip.title) || 'Trip planner';
    document.title = (plan.trip && plan.trip.title) || 'Trip planner';
    var links = document.querySelectorAll('#tabs a');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-tab') === tab);
    var v = document.getElementById('view');
    if (tab !== 'map' && map) { map.remove(); map = null; }
    v.innerHTML = '';
    var fn = { overview: renderOverview, calendar: renderCalendar, decisions: renderDecisions, map: renderMap, budget: renderBudget, todo: renderTodo, research: renderResearch, activity: renderActivity }[tab] || renderOverview;
    fn(v);
  }

  // ── Overview ───────────────────────────────────────────────────────────
  function renderOverview(v) {
    var decisions = plan.decisions || [];
    var counts = {};
    decisions.forEach(function (d) { counts[d.status] = (counts[d.status] || 0) + 1; });
    var days = C.daysBetween(todayIso(), plan.trip.start);
    var tasks = (plan.tasks || []).filter(function (t) { return !t.done; });
    var deadlines = tasks.filter(function (t) { return t.due; }).sort(function (a, b) { return a.due < b.due ? -1 : 1; });
    var waiting = tasks.filter(function (t) { return t.kind === 'waiting'; });
    var budget = C.budgetSummary(plan);
    var projected = budgetTotals(budget).projected;
    var openComments = (plan.comments || []).filter(function (c) { return !c.resolved; });

    v.appendChild(h('section', { class: 'tiles' },
      tile(days > 0 ? days : 0, 'days until departure', fmtDate(plan.trip.start, true) + ' → ' + fmtDate(plan.trip.end, true)),
      tile((counts.open || 0) + (counts.leaning || 0), 'decisions still open', (counts.leaning || 0) + ' leaning · ' + (counts.decided || 0) + ' decided · ' + (counts.booked || 0) + ' booked'),
      tile(deadlines.length ? fmtDate(deadlines[0].due) : '—', 'next deadline', deadlines.length ? (deadlines[0].short || deadlines[0].title) + ' · ' + relDays(deadlines[0].due) : 'none'),
      tile(waiting.length, 'things we\'re waiting on', waiting.slice(0, 2).map(function (t) { return t.owner; }).join(', ')),
      tile(range(projected.low, projected.high, 'USD'), 'projected spend', 'excl. flights · see Budget'),
      tile(openComments.length, 'comments for Brainy', openComments.length ? 'Brainy picks these up next session' : 'all caught up')
    ));

    v.appendChild(h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', null, 'Trip shape'), scenarioSwitcher()), tripStrip()));

    var needs = decisions.filter(function (d) { return d.status === 'open' || d.status === 'leaning'; })
      .sort(function (a, b) { return ((a.dates || [])[0] || 'z') < ((b.dates || [])[0] || 'z') ? -1 : 1; });
    var grid = h('div', { class: 'two-col' });
    grid.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Needs a decision'),
      h('p', { class: 'muted' }, 'In trip order. Click one to compare its options, vote, and pick.'),
      h('ul', { class: 'decision-list' }, needs.map(function (d) {
        var lead = C.leadingOption(d);
        return h('li', null,
          h('div', { class: 'row' }, openDecisionLink(d.id, d.title), statusPill(d.status)),
          h('div', { class: 'muted small' }, fmtDates(d.dates), d.dates && d.dates.length ? ' · ' : '', decisionProgress(d),
            lead ? h('span', null, ' · leaning ', h('em', null, lead.title)) : null));
      }))));

    var side = h('div');
    side.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Coming up'),
      h('ul', { class: 'task-list' }, deadlines.slice(0, 6).map(taskRow)),
      h('a', { href: link({ tab: 'todo' }) }, 'All deadlines & waiting →')));
    var notes = (plan.notes || []).filter(function (n) { return n.kind === 'risk'; });
    side.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Travel-agent flags'),
      h('ul', { class: 'notes' }, notes.map(noteRow)),
      h('a', { href: link({ tab: 'todo' }) }, 'All tips & ideas →')));
    grid.appendChild(side);
    v.appendChild(grid);
  }

  function tile(big, label, sub) {
    return h('div', { class: 'tile' }, h('div', { class: 'big' }, big), h('div', { class: 'label' }, label), h('div', { class: 'muted small' }, sub));
  }

  function noteRow(n) {
    var icon = { risk: '⚠️', tip: '💡', idea: '✨' }[n.kind] || '•';
    return h('li', { class: 'note note-' + n.kind },
      h('div', null, icon + ' ', h('strong', null, n.title)),
      n.body ? h('div', { class: 'small' }, n.body) : null,
      n.decisionId ? h('div', { class: 'small' }, openDecisionLink(n.decisionId, '→ ' + ((decisionById(n.decisionId) || {}).title || n.decisionId))) : null);
  }

  // A compact strip of the trip: one column per day, colored by base, with headcount.
  function tripStrip() {
    var days = C.tripDays(viewPlan());
    var max = Math.max.apply(null, days.map(function (d) { return C.headcount(plan, d.date); }).concat([1]));
    return h('div', { class: 'strip' }, days.map(function (d) {
      var n = C.headcount(plan, d.date);
      var open = d.items.filter(function (it) {
        var dec = it.decisionId && decisionById(it.decisionId);
        return dec && (dec.status === 'open' || dec.status === 'leaning');
      }).length;
      return h('a', { class: 'strip-day', href: link({ tab: 'calendar' }), title: d.weekday + ' ' + fmtDate(d.date) + ': ' + (d.base ? d.base.name : 'travel') + ', ' + n + ' people' },
        h('div', { class: 'strip-bar' }, h('div', { style: 'height:' + Math.round((n / max) * 100) + '%' })),
        h('div', { class: 'strip-n' }, n),
        h('div', { class: 'strip-base', style: 'background:' + (d.base ? d.base.color : '#aaa') }),
        h('div', { class: 'strip-date' }, d.weekday.substring(0, 2), h('br'), d.date.substring(8)),
        open ? h('div', { class: 'strip-open', title: open + ' open decision(s)' }, open) : null);
    }));
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  function renderCalendar(v) {
    var days = C.tripDays(viewPlan());
    var switcher = scenarioSwitcher();
    if (switcher) v.appendChild(h('section', { class: 'card' }, switcher));
    v.appendChild(h('section', { class: 'card' },
      h('div', { class: 'row' }, h('h2', null, 'Who\'s where'),
        h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: ui.showAlternatives, onchange: function (e) { ui.showAlternatives = e.target.checked; render(); } }), ' show alternatives under each open decision')),
      presenceGrid(days)));

    var list = h('section', { class: 'days' });
    days.forEach(function (d) {
      var bySlot = {};
      d.items.forEach(function (it) { (bySlot[it.slot || 'day'] = bySlot[it.slot || 'day'] || []).push(it); });
      var people = C.travelersOn(plan, d.date);
      list.appendChild(h('article', { class: 'day', style: 'border-left-color:' + (d.base ? d.base.color : '#aaa') },
        h('div', { class: 'day-head' },
          h('div', { class: 'day-date' }, h('span', { class: 'wd' }, d.weekday), ' ', fmtDate(d.date)),
          basePill(d.base),
          h('span', { class: 'muted small', title: people.map(function (p) { return p.name + ' (' + (p.count || 1) + ')'; }).join(', ') }, '👥 ' + C.headcount(plan, d.date)),
          d.note ? h('span', { class: 'muted small' }, d.note) : null),
        h('div', { class: 'slots' }, SLOT_ORDER.filter(function (s) { return bySlot[s]; }).map(function (s) {
          return h('div', { class: 'slot' }, h('div', { class: 'slot-label' }, SLOT_LABEL[s]), h('div', { class: 'slot-items' }, bySlot[s].map(dayItem)));
        }))));
    });
    v.appendChild(list);
  }

  function presenceGrid(days) {
    var table = h('table', { class: 'presence' });
    table.appendChild(h('tr', null, h('th'), days.map(function (d) {
      return h('th', { class: 'small' }, d.weekday.substring(0, 2), h('br'), d.date.substring(8));
    })));
    table.appendChild(h('tr', null, h('th', { class: 'row-label' }, 'Base (night)'), days.map(function (d) {
      return h('td', { class: 'base-cell', style: 'background:' + (d.base ? d.base.color : '#d8d2c8'), title: d.base ? d.base.name : 'in transit' }, d.base ? d.base.short || d.base.name.substring(0, 3) : '✈︎');
    })));
    (plan.travelers || []).forEach(function (t) {
      table.appendChild(h('tr', null, h('th', { class: 'row-label' }, t.name, t.status && t.status !== 'booked' ? h('span', { class: 'muted small' }, ' (' + t.status + ')') : null),
        days.map(function (d) {
          var here = t.from && t.to && d.date >= t.from && d.date <= t.to;
          return h('td', { class: here ? 'here ' + (t.status || '') : (t.from ? '' : 'tbd') }, here ? (t.count > 1 ? t.count : '●') : (t.from ? '' : '?'));
        })));
      if (t.note) table.lastChild.firstChild.title = t.note;
    });
    table.appendChild(h('tr', { class: 'total' }, h('th', { class: 'row-label' }, 'Headcount'), days.map(function (d) {
      return h('td', null, C.headcount(plan, d.date));
    })));
    return h('div', { class: 'scroll-x' }, table);
  }

  function dayItem(it) {
    var d = it.decisionId && decisionById(it.decisionId);
    if (!d) {
      return h('div', { class: 'item item-' + (it.status || 'idea') },
        h('div', null, it.title), it.note ? h('div', { class: 'muted small' }, it.note) : null);
    }
    var lead = C.leadingOption(d);
    var chosen = (d.chosen || []).map(function (id) { return C.findOption(d, id); }).filter(Boolean);
    var label = chosen.length ? chosen.map(function (o) { return o.title; }).join(' + ') : (it.title || d.title);
    var state = d.status === 'booked' ? 'booked' : chosen.length ? 'decided' : d.status === 'leaning' ? 'leaning' : 'open';
    var el = h('a', { class: 'item item-' + state, href: link(Object.assign(tabParams(), { decision: d.id })) },
      h('div', null, state === 'open' || state === 'leaning' ? '◇ ' : '✓ ', label),
      h('div', { class: 'muted small' }, chosen.length ? (it.title || d.title) : decisionProgress(d) + (lead ? ' · leaning ' + lead.title : '')),
      it.note ? h('div', { class: 'muted small' }, it.note) : null);
    if (ui.showAlternatives && !chosen.length) {
      el.appendChild(h('ul', { class: 'alts' }, activeOptions(d).map(function (o) {
        return h('li', null, o.title, ' ', voteSummary(o));
      })));
    }
    return el;
  }

  // ── Decisions ──────────────────────────────────────────────────────────
  function renderDecisions(v) {
    var filters = h('div', { class: 'filters' },
      segmented([['active', 'Open & leaning'], ['decided', 'Decided & booked'], ['all', 'All']], ui.decisionFilter, function (val) { ui.decisionFilter = val; render(); }),
      segmented([['all', 'All kinds']].concat(Object.keys(CATEGORY_LABEL).map(function (k) { return [k, CATEGORY_LABEL[k]]; })), ui.decisionCategory, function (val) { ui.decisionCategory = val; render(); }),
      h('input', { type: 'search', placeholder: 'Search decisions & options…', value: ui.decisionSearch, oninput: function (e) {
        ui.decisionSearch = e.target.value;
        renderDecisionCards(document.getElementById('decision-cards'));
      } }));
    v.appendChild(filters);
    var cards = h('div', { id: 'decision-cards', class: 'decision-cards' });
    v.appendChild(cards);
    renderDecisionCards(cards);
  }

  function segmented(choices, current, onPick) {
    return h('div', { class: 'segmented' }, choices.map(function (c) {
      return h('button', { type: 'button', class: c[0] === current ? 'on' : '', onclick: function () { onPick(c[0]); } }, c[1]);
    }));
  }

  function matchesSearch(d, q) {
    if (!q) return true;
    q = q.toLowerCase();
    var hay = [d.title, d.question, d.context].concat((d.options || []).map(function (o) { return o.title + ' ' + (o.summary || ''); })).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderDecisionCards(el) {
    el.innerHTML = '';
    var list = (plan.decisions || []).filter(function (d) {
      if (ui.decisionFilter === 'active' && !(d.status === 'open' || d.status === 'leaning')) return false;
      if (ui.decisionFilter === 'decided' && !(d.status === 'decided' || d.status === 'booked')) return false;
      if (ui.decisionCategory !== 'all' && d.category !== ui.decisionCategory) return false;
      return matchesSearch(d, ui.decisionSearch);
    }).sort(function (a, b) { return ((a.dates || [])[0] || 'z') < ((b.dates || [])[0] || 'z') ? -1 : 1; });
    if (!list.length) { el.appendChild(h('p', { class: 'muted' }, 'Nothing matches.')); return; }
    list.forEach(function (d) {
      var lead = C.leadingOption(d);
      var cmts = commentsFor(d.id).filter(function (c) { return !c.resolved; }).length;
      el.appendChild(h('a', { class: 'decision-card cat-' + d.category, href: link(Object.assign(tabParams(), { decision: d.id })) },
        h('div', { class: 'row' }, h('span', { class: 'muted small' }, (CATEGORY_LABEL[d.category] || d.category) + (d.dates && d.dates.length ? ' · ' + fmtDates(d.dates) : '')), statusPill(d.status)),
        h('h3', null, d.title),
        d.question ? h('p', { class: 'small' }, d.question) : null,
        h('div', { class: 'opt-chips' }, activeOptions(d).map(function (o) {
          return h('span', { class: 'opt-chip' + (isChosen(d, o) ? ' chosen' : '') + (lead && lead.id === o.id && !isChosen(d, o) ? ' leading' : '') },
            isChosen(d, o) ? '✓ ' : '', o.title, C.netVotes(o) ? ' (' + (C.netVotes(o) > 0 ? '+' : '') + C.netVotes(o) + ')' : '');
        })),
        h('div', { class: 'muted small' }, decisionProgress(d), cmts ? ' · 💬 ' + cmts : '')));
    });
  }

  // ── Decision drawer (compare + vote + choose + comment) ───────────────
  var drawerDecision = null;

  function openDrawer(id) {
    var d = decisionById(id);
    if (!d) { toast('Unknown decision ' + id, true); return; }
    drawerDecision = id;
    document.getElementById('drawer').hidden = false;
    document.getElementById('drawer-backdrop').hidden = false;
    document.body.classList.add('drawer-open');
    refreshDrawer();
  }

  function closeDrawer() {
    drawerDecision = null;
    document.getElementById('drawer').hidden = true;
    document.getElementById('drawer-backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
    if (C.parseHash(location.hash).decision) history.replaceState(null, '', link(tabParams()));
  }

  function refreshDrawer() {
    if (!drawerDecision) return;
    var d = decisionById(drawerDecision);
    var body = document.getElementById('drawer-body');
    var scroll = document.getElementById('drawer').scrollTop;
    body.innerHTML = '';
    if (!d) return;
    body.appendChild(decisionDetail(d));
    document.getElementById('drawer').scrollTop = scroll;
  }

  function decisionDetail(d) {
    var wrap = h('div', { class: 'detail' });
    var statusSel = h('select', { onchange: function (e) { op({ type: 'setDecisionStatus', decisionId: d.id, status: e.target.value }); } },
      C.DECISION_STATUSES.map(function (s) { return h('option', { value: s, selected: s === d.status }, STATUS_LABEL[s]); }));
    wrap.appendChild(h('div', { class: 'detail-head' },
      h('div', { class: 'muted small' }, (CATEGORY_LABEL[d.category] || d.category), d.dates && d.dates.length ? ' · ' + fmtDates(d.dates) : '', d.nights ? ' · ' + d.nights + ' nights' : ''),
      h('h2', null, d.title),
      h('div', { class: 'row' }, h('label', { class: 'small' }, 'Status ', statusSel),
        d.multi ? h('span', { class: 'pill' }, 'pick several') : null,
        typeof d.shareOfGroup === 'number' ? h('span', { class: 'pill', title: 'Group costs are multiplied by this to get our share' }, 'our share of group costs: ' + Math.round(d.shareOfGroup * 100) + '%') : null)));
    if (d.question) wrap.appendChild(h('p', { class: 'question' }, d.question));
    if (d.context) wrap.appendChild(renderMarkdown(d.context));
    if (d.agentTake) wrap.appendChild(h('div', { class: 'agent-take' }, h('strong', null, '🧳 Brainy\'s take: '), d.agentTake));
    if (d.refs && d.refs.length) {
      wrap.appendChild(h('div', { class: 'small refs' }, 'Research: ', d.refs.map(function (r, i) {
        return [i ? ' · ' : '', h('a', { href: link({ research: r }) }, r.split('/').pop())];
      })));
    }

    var options = (d.options || []).filter(function (o) { return !(ui.hideRejected && o.status === 'rejected'); });
    var rejected = (d.options || []).length - activeOptions(d).length;
    wrap.appendChild(h('div', { class: 'row compare-bar' },
      h('h3', null, 'Options'),
      rejected ? h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: !ui.hideRejected, onchange: function (e) { ui.hideRejected = !e.target.checked; refreshDrawer(); } }), ' show ' + rejected + ' rejected') : null));
    wrap.appendChild(h('div', { class: 'compare' }, options.map(function (o) { return optionCard(d, o); }), addOptionCard(d)));

    var general = commentsFor(d.id, null);
    wrap.appendChild(h('div', { class: 'comments' },
      h('h3', null, 'Discussion'),
      general.map(commentRow),
      commentBox(d.id, null, 'Comment on this decision (Brainy will pick it up)…')));
    return wrap;
  }

  function optionCard(d, o) {
    var me = who();
    var mine = (o.votes || {})[me] || 0;
    var lead = C.leadingOption(d);
    var badges = [];
    if (isChosen(d, o)) badges.push(h('span', { class: 'badge chosen' }, '✓ Chosen'));
    if (d.recommended === o.id) badges.push(h('span', { class: 'badge rec' }, '★ Brainy\'s pick'));
    if (lead && lead.id === o.id && !isChosen(d, o)) badges.push(h('span', { class: 'badge lead' }, 'Leading'));
    if (o.status === 'shortlisted') badges.push(h('span', { class: 'badge short' }, 'Shortlisted'));
    if (o.status === 'rejected') badges.push(h('span', { class: 'badge rej' }, 'Rejected'));
    if (o.addedBy) badges.push(h('span', { class: 'badge' }, 'added by ' + o.addedBy));

    var facts = [
      ['📍', o.location], ['⏱', o.duration], ['🚶', o.walkTo], ['🛗', o.elevator === true ? 'Elevator' : o.elevator === false ? 'No elevator' : null],
      ['👵', o.parentFriendly], ['⭐', o.rating], ['🗣', o.source ? 'Source: ' + o.source : null],
    ].filter(function (f) { return f[1]; });

    var optComments = commentsFor(d.id, o.id);
    return h('div', { class: 'option' + (isChosen(d, o) ? ' is-chosen' : '') + (o.status === 'rejected' ? ' is-rejected' : '') },
      h('div', { class: 'badges' }, badges),
      h('h4', null, o.title),
      o.summary ? h('p', { class: 'small' }, o.summary) : null,
      h('div', { class: 'cost' }, '💶 ', costLine(o, d)),
      o.cost && o.cost.note && C.ourCost(o, d, plan.settings) ? h('div', { class: 'muted tiny' }, rawCost(o.cost), ' · ', o.cost.note) : null,
      facts.length ? h('ul', { class: 'facts' }, facts.map(function (f) { return h('li', null, f[0] + ' ', f[1]); })) : null,
      o.pros && o.pros.length ? h('ul', { class: 'pros' }, o.pros.map(function (p) { return h('li', null, p); })) : null,
      o.cons && o.cons.length ? h('ul', { class: 'cons' }, o.cons.map(function (p) { return h('li', null, p); })) : null,
      o.agentTake ? h('div', { class: 'agent-take small' }, '🧳 ', o.agentTake) : null,
      o.links && o.links.length ? h('div', { class: 'links small' }, o.links.map(extLink).filter(Boolean).map(function (a, i) { return [i ? ' · ' : '', a]; })) : null,
      o.verified ? h('div', { class: 'muted tiny' }, '🔎 ', o.verified) : null,
      h('div', { class: 'vote-row' },
        h('button', { type: 'button', class: 'vote-btn' + (mine === 1 ? ' on' : ''), title: 'Like', onclick: function () { op({ type: 'vote', decisionId: d.id, optionId: o.id, value: mine === 1 ? 0 : 1 }); } }, '👍'),
        h('button', { type: 'button', class: 'vote-btn' + (mine === -1 ? ' on' : ''), title: 'Not keen', onclick: function () { op({ type: 'vote', decisionId: d.id, optionId: o.id, value: mine === -1 ? 0 : -1 }); } }, '👎'),
        voteSummary(o)),
      h('div', { class: 'action-row' },
        h('button', { type: 'button', class: 'primary', onclick: function () {
          op({ type: 'choose', decisionId: d.id, optionId: isChosen(d, o) && !d.multi ? null : o.id });
        } }, isChosen(d, o) ? (d.multi ? 'Remove' : 'Un-choose') : (d.multi ? 'Add to plan' : 'Choose this')),
        o.status !== 'shortlisted' && o.status !== 'rejected' ? h('button', { type: 'button', onclick: function () { op({ type: 'setOptionStatus', decisionId: d.id, optionId: o.id, status: 'shortlisted' }); } }, 'Shortlist') : null,
        o.status !== 'rejected'
          ? h('button', { type: 'button', class: 'danger', onclick: function () { op({ type: 'setOptionStatus', decisionId: d.id, optionId: o.id, status: 'rejected' }); } }, 'Reject')
          : h('button', { type: 'button', onclick: function () { op({ type: 'setOptionStatus', decisionId: d.id, optionId: o.id, status: 'candidate' }); } }, 'Restore')),
      optComments.length ? h('div', { class: 'opt-comments' }, optComments.map(commentRow)) : null,
      commentBox(d.id, o.id, 'Note on this option…'));
  }

  function rawCost(cost) {
    var unit = { 'room-night': 'per room-night', person: 'per person', group: 'for the whole group', vehicle: 'per vehicle', party: 'for our party', total: 'total' }[cost.unit] || cost.unit || '';
    return range(cost.low, typeof cost.high === 'number' ? cost.high : cost.low, cost.currency) + ' ' + unit;
  }

  function addOptionCard(d) {
    var title = h('input', { type: 'text', placeholder: 'Name (e.g. a hotel you found)' });
    var url = h('input', { type: 'url', placeholder: 'Link (optional)' });
    var summary = h('textarea', { rows: 3, placeholder: 'Why it might work…' });
    return h('form', { class: 'option add-option', onsubmit: function (e) {
      e.preventDefault();
      if (!title.value.trim()) return;
      op({ type: 'addOption', decisionId: d.id, title: title.value, url: url.value.trim() || undefined, summary: summary.value })
        .then(function () { toast('Added. Brainy will research it next session.'); });
    } }, h('h4', null, '+ Add an option'), title, url, summary, h('button', { type: 'submit', class: 'primary' }, 'Add'));
  }

  function commentRow(c) {
    return h('div', { class: 'comment' + (c.resolved ? ' resolved' : '') },
      h('div', { class: 'small' }, h('strong', null, c.who), ' ', h('span', { class: 'muted' }, timeAgo(c.at)),
        h('button', { type: 'button', class: 'link-btn', onclick: function () { op({ type: 'resolveComment', commentId: c.id }); } }, c.resolved ? 'reopen' : 'resolve')),
      h('div', null, c.text));
  }

  function commentBox(decisionId, optionId, placeholder) {
    var ta = h('textarea', { rows: 2, placeholder: placeholder });
    return h('form', { class: 'comment-box', onsubmit: function (e) {
      e.preventDefault();
      if (!ta.value.trim()) return;
      op({ type: 'comment', decisionId: decisionId || undefined, optionId: optionId || undefined, text: ta.value });
    } }, ta, h('button', { type: 'submit' }, 'Post'));
  }

  // ── Map ────────────────────────────────────────────────────────────────
  var MAP_COLORS = { lodging: '#7b4fa0', transport: '#555', activity: '#c0583a', food: '#5b7f3a', strategy: '#888' };

  function renderMap(v) {
    if (typeof L === 'undefined') { v.appendChild(h('p', { class: 'error' }, 'Leaflet did not load (offline?).')); return; }
    var layerDefs = [['bases', 'Bases'], ['routes', 'Routes']].concat(Object.keys(CATEGORY_LABEL).map(function (k) { return [k, CATEGORY_LABEL[k] + ' options']; })).concat([['places', 'Places & day trips']]);
    layerDefs.forEach(function (l) { if (ui.mapLayers[l[0]] === undefined) ui.mapLayers[l[0]] = true; });
    var controls = h('div', { class: 'map-controls' }, layerDefs.map(function (l) {
      return h('label', { class: 'small' }, h('input', { type: 'checkbox', checked: ui.mapLayers[l[0]], onchange: function (e) { ui.mapLayers[l[0]] = e.target.checked; render(); } }), ' ', l[1]);
    }), h('span', { class: 'muted small' }, 'Big dot = chosen · ringed = leading'),
    h('span', { class: 'zoom-to' }, 'Zoom: ', h('button', { type: 'button', onclick: function () { map.fitBounds(ui.mapBounds, { padding: [30, 30] }); } }, 'Whole trip'),
      (viewPlan().bases || []).map(function (b) {
        var p = (plan.places || []).filter(function (x) { return x.id === b.placeId; })[0];
        return p ? h('button', { type: 'button', onclick: function () { map.setView([p.lat, p.lng], 15); } }, b.name) : null;
      })));
    v.appendChild(controls);
    var el = h('div', { id: 'map' });
    v.appendChild(el);
    map = L.map(el);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    var bounds = [];
    var placesById = {};
    (plan.places || []).forEach(function (p) { placesById[p.id] = p; });

    if (ui.mapLayers.routes) {
      (plan.legs || []).forEach(function (leg) {
        var pts = leg.path.map(function (id) { return placesById[id]; }).filter(Boolean).map(function (p) { return [p.lat, p.lng]; });
        if (pts.length < 2) return;
        L.polyline(pts, { color: leg.color || '#555', weight: 3, dashArray: leg.decisionId ? '6 6' : null, opacity: 0.8 })
          .bindPopup(popup(h('div', null, h('strong', null, fmtDate(leg.date, true) + ': ' + leg.label), leg.decisionId ? h('div', null, openDecisionLink(leg.decisionId, 'Open decision →')) : null)))
          .addTo(map);
      });
    }
    if (ui.mapLayers.places) {
      (plan.places || []).filter(function (p) { return p.kind !== 'base'; }).forEach(function (p) {
        L.circleMarker([p.lat, p.lng], { radius: 5, color: '#333', weight: 1, fillColor: '#fff', fillOpacity: 1 })
          .bindTooltip(p.name).bindPopup(popup(h('div', null, h('strong', null, p.name), p.note ? h('div', { class: 'small' }, p.note) : null))).addTo(map);
        bounds.push([p.lat, p.lng]);
      });
    }
    (plan.decisions || []).forEach(function (d) {
      if (!ui.mapLayers[d.category] || d.status === 'dropped') return;
      var lead = C.leadingOption(d);
      activeOptions(d).forEach(function (o) {
        if (typeof o.lat !== 'number') return;
        var chosen = isChosen(d, o);
        var m = L.circleMarker([o.lat, o.lng], {
          radius: chosen ? 10 : 7, color: lead && lead.id === o.id ? '#000' : '#fff', weight: lead && lead.id === o.id ? 3 : 1.5,
          fillColor: MAP_COLORS[d.category] || '#c0583a', fillOpacity: chosen ? 1 : 0.75,
        });
        m.bindTooltip(o.title).bindPopup(popup(h('div', null,
          h('div', { class: 'muted small' }, d.title), h('strong', null, o.title), o.summary ? h('div', { class: 'small' }, o.summary) : null,
          h('div', { class: 'small' }, costLine(o, d)), voteSummary(o), h('div', null, openDecisionLink(d.id, 'Compare options →'))))).addTo(map);
        bounds.push([o.lat, o.lng]);
      });
    });
    if (ui.mapLayers.bases) {
      (viewPlan().bases || []).forEach(function (b) {
        var p = placesById[b.placeId];
        if (!p) return;
        L.circleMarker([p.lat, p.lng], { radius: 16, color: b.color, weight: 3, fillColor: b.color, fillOpacity: 0.25 })
          .bindTooltip(b.name + ' · ' + fmtDate(b.from) + '–' + fmtDate(b.to), { permanent: true, direction: 'top', className: 'base-label' }).addTo(map);
        bounds.push([p.lat, p.lng]);
      });
    }
    ui.mapBounds = bounds.length ? bounds : [[36.6, 6.6], [47.1, 18.5]];
    map.fitBounds(ui.mapBounds, { padding: [30, 30] });
  }

  function popup(node) {
    // Leaflet accepts an element; links inside use the hash router.
    return node;
  }

  // ── Budget ─────────────────────────────────────────────────────────────
  function budgetTotals(summary) {
    var t = { committed: { low: 0, high: 0 }, projected: { low: 0, high: 0 } };
    Object.keys(summary.categories).forEach(function (k) {
      ['committed', 'projected'].forEach(function (key) {
        t[key].low += summary.categories[k][key].low;
        t[key].high += summary.categories[k][key].high;
      });
    });
    ((plan.budget && plan.budget.estimates) || []).forEach(function (e) {
      t.projected.low += e.usdLow;
      t.projected.high += e.usdHigh;
    });
    return t;
  }

  function renderBudget(v) {
    var s = C.budgetSummary(plan);
    var totals = budgetTotals(s);
    var settings = plan.settings || {};
    var b = plan.budget || {};

    v.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Spend so far vs. plan'),
      h('p', { class: 'muted small' }, 'Our party\'s share only, in USD at €1 = $' + settings.eurToUsd + '. "Committed" = chosen options. "Projected" = chosen, or the leading option (most 👍, else Brainy\'s pick) where nothing is chosen yet. Flights are booked and not counted.'),
      (b.targets || []).map(function (t) { return targetBar(t, s, totals); })));

    var table = h('table', { class: 'budget' },
      h('tr', null, h('th', null, 'Category'), h('th', null, 'Committed'), h('th', null, 'Projected'), h('th', null, 'Where it comes from')));
    Object.keys(s.categories).sort().forEach(function (k) {
      var c = s.categories[k];
      table.appendChild(h('tr', null,
        h('td', null, BUDGET_LABEL[k] || k),
        h('td', null, range(c.committed.low, c.committed.high, 'USD')),
        h('td', null, range(c.projected.low, c.projected.high, 'USD')),
        h('td', { class: 'small' }, c.items.map(function (it, i) {
          var d = decisionById(it.decisionId);
          var o = C.findOption(d, it.optionId);
          return h('div', null, it.basis === 'chosen' ? '✓ ' : '◇ ', openDecisionLink(d.id, d.title), ': ', o.title, ' ', h('span', { class: 'muted' }, range(it.usdLow, it.usdHigh, 'USD')));
        }))));
    });
    (b.estimates || []).forEach(function (e) {
      table.appendChild(h('tr', null, h('td', null, e.label), h('td', null, '—'), h('td', null, range(e.usdLow, e.usdHigh, 'USD')), h('td', { class: 'small muted' }, e.note || '')));
    });
    table.appendChild(h('tr', { class: 'total' }, h('td', null, 'Total'), h('td', null, range(totals.committed.low, totals.committed.high, 'USD')), h('td', null, range(totals.projected.low, totals.projected.high, 'USD')), h('td')));
    v.appendChild(h('section', { class: 'card' }, h('h2', null, 'By category'), h('div', { class: 'scroll-x' }, table)));

    if (s.uncosted.length) {
      v.appendChild(h('section', { class: 'card' }, h('h2', null, 'Not costed yet'),
        h('p', { class: 'muted small' }, 'These decisions have no price on their chosen/leading option, so the totals above leave them out.'),
        h('ul', null, s.uncosted.map(function (d) { return h('li', null, openDecisionLink(d.id, d.title || d.id)); }))));
    }
    (b.fixed || []).length && v.appendChild(h('section', { class: 'card' }, h('h2', null, 'Already paid (not in totals)'),
      h('ul', null, b.fixed.map(function (f) { return h('li', null, f.label + ': ' + money(f.usd, 'USD')); }))));

    v.appendChild(h('section', { class: 'card' }, h('h2', null, 'Assumptions'),
      h('div', { class: 'row settings' }, [['eurToUsd', 'USD per €1', 0.01], ['partySize', 'People in our party', 1], ['rooms', 'Rooms we pay for', 1]].map(function (s2) {
        var input = h('input', { type: 'number', step: s2[2], min: 0, value: settings[s2[0]] });
        return h('label', { class: 'small' }, s2[1] + ' ', input, h('button', { type: 'button', onclick: function () {
          op({ type: 'setSetting', key: s2[0], value: Number(input.value) });
        } }, 'Save'));
      }))));
  }

  function targetBar(t, s, totals) {
    var spent;
    if (t.categories) {
      spent = { low: 0, high: 0, committed: 0 };
      t.categories.forEach(function (k) {
        var c = s.categories[k];
        if (!c) return;
        spent.low += c.projected.low; spent.high += c.projected.high; spent.committed += c.committed.high;
      });
    } else {
      spent = { low: totals.projected.low, high: totals.projected.high, committed: totals.committed.high };
    }
    var cap = t.usdHigh || t.usd;
    var max = Math.max(cap, spent.high) * 1.05;
    function pct(n) { return Math.min(100, (n / max) * 100) + '%'; }
    return h('div', { class: 'target' },
      h('div', { class: 'row' }, h('strong', null, t.label), h('span', { class: 'small' }, 'projected ' + range(spent.low, spent.high, 'USD') + ' vs target ' + (t.usdLow ? range(t.usdLow, t.usdHigh, 'USD') : money(t.usd, 'USD')))),
      h('div', { class: 'bar' },
        h('div', { class: 'bar-range', style: 'left:' + pct(spent.low) + ';width:calc(' + pct(spent.high) + ' - ' + pct(spent.low) + ')' }),
        h('div', { class: 'bar-fill', style: 'width:' + pct(spent.low) }),
        h('div', { class: 'bar-committed', style: 'width:' + pct(spent.committed) }),
        t.usdLow ? h('div', { class: 'bar-target-zone', style: 'left:' + pct(t.usdLow) + ';width:calc(' + pct(t.usdHigh) + ' - ' + pct(t.usdLow) + ')' }) : null,
        h('div', { class: 'bar-target', style: 'left:' + pct(cap) })),
      t.note ? h('div', { class: 'muted small' }, t.note) : null);
  }

  // ── Deadlines, waiting-on, tips ────────────────────────────────────────
  function taskRow(t) {
    var overdue = t.due && !t.done && t.due < todayIso();
    var soon = t.due && !t.done && !overdue && C.daysBetween(todayIso(), t.due) <= 21;
    return h('li', { class: 'task' + (t.done ? ' done' : '') + (overdue ? ' overdue' : '') + (soon ? ' soon' : '') },
      h('input', { type: 'checkbox', checked: !!t.done, title: 'Mark done', onchange: function () { op({ type: 'toggleTask', taskId: t.id }); } }),
      h('div', null,
        h('div', null, t.title),
        h('div', { class: 'muted small' },
          t.due ? fmtDate(t.due) + ' (' + relDays(t.due) + ')' : null,
          t.due && t.owner ? ' · ' : null, t.owner || null,
          t.decisionId ? [' · ', openDecisionLink(t.decisionId, (decisionById(t.decisionId) || {}).title || t.decisionId)] : null),
        t.note ? h('div', { class: 'small' }, t.note) : null));
  }

  function renderTodo(v) {
    var tasks = plan.tasks || [];
    var deadlines = tasks.filter(function (t) { return t.kind === 'deadline'; }).sort(function (a, b) { return (a.due || 'z') < (b.due || 'z') ? -1 : 1; });
    var waiting = tasks.filter(function (t) { return t.kind === 'waiting'; });
    var todos = tasks.filter(function (t) { return t.kind === 'todo' || t.kind === 'question'; });

    v.appendChild(h('section', { class: 'card' }, h('h2', null, 'Booking timeline'),
      h('p', { class: 'muted small' }, 'When each thing has to be booked by, from today to departure.'), timeline(deadlines)));
    var grid = h('div', { class: 'two-col' });
    grid.appendChild(h('section', { class: 'card' }, h('h2', null, 'Book-by deadlines'), h('ul', { class: 'task-list' }, deadlines.map(taskRow))));
    var right = h('div');
    right.appendChild(h('section', { class: 'card' }, h('h2', null, 'Waiting on others'), groupedTasks(waiting)));
    right.appendChild(h('section', { class: 'card' }, h('h2', null, 'Our to-dos & open questions'), h('ul', { class: 'task-list' }, todos.map(taskRow))));
    grid.appendChild(right);
    v.appendChild(grid);
    v.appendChild(h('section', { class: 'card' }, h('h2', null, 'Travel-agent notes'), h('ul', { class: 'notes' }, (plan.notes || []).map(noteRow))));
  }

  function groupedTasks(list) {
    var by = {};
    list.forEach(function (t) { (by[t.owner || 'Someone'] = by[t.owner || 'Someone'] || []).push(t); });
    return Object.keys(by).map(function (owner) {
      return h('div', { class: 'group' }, h('h4', null, owner), h('ul', { class: 'task-list' }, by[owner].map(taskRow)));
    });
  }

  function timeline(deadlines) {
    var start = todayIso();
    var end = plan.trip.start;
    var total = Math.max(1, C.daysBetween(start, end));
    var el = h('div', { class: 'timeline' });
    // month ticks
    for (var iso = start.substring(0, 8) + '01'; iso <= end; iso = C.addDays(iso.substring(0, 8) + '28', 4).substring(0, 8) + '01') {
      var off = C.daysBetween(start, iso);
      if (off < 0) continue;
      el.appendChild(h('div', { class: 'tick', style: 'left:' + (off / total) * 100 + '%' }, MONTHS[Number(iso.substring(5, 7)) - 1]));
    }
    el.appendChild(h('div', { class: 'tick trip', style: 'left:100%' }, '✈︎'));
    var lanes = [];
    deadlines.filter(function (t) { return t.due; }).forEach(function (t) {
      var pos = Math.max(0, Math.min(1, C.daysBetween(start, t.due) / total));
      var lane = 0;
      while (lanes[lane] !== undefined && pos - lanes[lane] < 0.09) lane++;
      lanes[lane] = pos;
      el.appendChild(h('div', { class: 'tl-dot' + (t.done ? ' done' : t.due < start ? ' overdue' : ''), style: 'left:' + pos * 100 + '%;top:' + (28 + lane * 22) + 'px', title: fmtDate(t.due) + ': ' + t.title },
        h('span', null, t.short || t.title)));
    });
    el.style.height = (40 + lanes.length * 22) + 'px';
    return h('div', { class: 'timeline-wrap' }, el);
  }

  // ── Research reader ────────────────────────────────────────────────────
  function renderResearch(v) {
    var listEl = h('ul', { class: 'research-list' }, h('li', { class: 'muted' }, 'Loading…'));
    var reader = h('div', { class: 'reader card' }, h('p', { class: 'muted' }, 'Pick an entry to read it here.'));
    v.appendChild(h('div', { class: 'research' }, h('div', { class: 'card' }, h('h2', null, 'Brainy research'), listEl), reader));
    var prefix = (plan.trip && plan.trip.researchPrefixes) || [];
    Promise.all(prefix.map(function (p) {
      return store.list(p);
    })).then(function (lists) {
      var seen = {};
      var entries = [].concat.apply([], lists).filter(function (e) { if (seen[e.path] || /planner\.md$/.test(e.path)) return false; seen[e.path] = true; return true; });
      listEl.innerHTML = '';
      entries.forEach(function (e) {
        listEl.appendChild(h('li', { class: ui.researchPath === e.path ? 'on' : '' }, h('a', { href: link({ research: e.path }) }, e.path), e.summary ? h('div', { class: 'muted small' }, e.summary) : null));
      });
    }).catch(function (e) {
      listEl.innerHTML = '';
      listEl.appendChild(h('li', { class: 'error' }, 'Could not list research: ' + e.message));
    });
    if (ui.researchPath) {
      reader.innerHTML = '';
      reader.appendChild(h('p', { class: 'muted' }, 'Loading ' + ui.researchPath + '…'));
      var path = ui.researchPath;
      store.get(path).then(function (e) {
        reader.innerHTML = '';
        reader.appendChild(h('div', { class: 'muted small' }, path));
        reader.appendChild(e && e.content ? renderMarkdown(e.content) : h('p', { class: 'error' }, 'Not found'));
      }).catch(function (e) {
        reader.innerHTML = '';
        reader.appendChild(h('p', { class: 'error' }, 'Could not load ' + path + ': ' + e.message));
      });
    }
  }

  // ── Comments & activity ────────────────────────────────────────────────
  function renderActivity(v) {
    var open = (plan.comments || []).filter(function (c) { return !c.resolved; });
    var grid = h('div', { class: 'two-col' });
    grid.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Open comments (' + open.length + ')'),
      h('p', { class: 'muted small' }, 'Brainy reads these at the start of the next planning session, acts on them, and resolves them.'),
      open.map(function (c) {
        var d = c.decisionId && decisionById(c.decisionId);
        var o = d && c.optionId && C.findOption(d, c.optionId);
        return h('div', null, d ? h('div', { class: 'small' }, openDecisionLink(d.id, d.title), o ? ' › ' + o.title : '') : h('div', { class: 'small muted' }, 'General'), commentRow(c));
      }),
      h('h3', null, 'General note for Brainy'),
      commentBox(null, null, 'e.g. "we\'d rather change hotels less often" or "research cooking classes near the second base"')));
    grid.appendChild(h('section', { class: 'card' },
      h('h2', null, 'Recent activity'),
      h('ul', { class: 'log' }, (plan.log || []).slice(0, 80).map(function (l) {
        return h('li', null, h('span', { class: 'muted small' }, timeAgo(l.at) + ' '), h('strong', null, l.who), ' ', l.text);
      }))));
    v.appendChild(grid);
  }

  // ── Routing ────────────────────────────────────────────────────────────
  // #entry=<path>[&tab=<tab> | &research=<path>][&decision=<id>]
  function route() {
    var params = C.parseHash(location.hash);
    var next = C.normalizeEntryPath(params.entry);
    if (next && next !== entryPath) {
      entryPath = next;
      plan = null;
      closeDrawerQuiet();
      setTabLinks();
      return load().then(route);
    }
    if (!plan) return;
    if (params.research) ui.researchPath = params.research;
    var nextTab = params.research ? 'research' : (params.tab || 'overview');
    if (params.decision) {
      if (nextTab !== tab) { tab = nextTab; render(); }
      openDrawer(params.decision);
      return;
    }
    tab = nextTab;
    closeDrawerQuiet();
    render();
    if (params.research) window.scrollTo(0, 0);
  }

  function closeDrawerQuiet() {
    drawerDecision = null;
    document.getElementById('drawer').hidden = true;
    document.getElementById('drawer-backdrop').hidden = true;
    document.body.classList.remove('drawer-open');
  }

  window.addEventListener('hashchange', route);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawerDecision) closeDrawer(); });
  document.getElementById('reload-btn').addEventListener('click', function () { load().then(function () { toast('Reloaded from Brainy'); }); });

  // ── Boot: mock mode, or Supabase sign-in ───────────────────────────────
  function start(client, path) {
    store = EntryStore.createEntryStore({ client: client, apply: C.applyOp });
    entryPath = path;
    document.getElementById('auth-section').hidden = true;
    document.getElementById('app').hidden = false;
    setTabLinks();
    if (hashEntry() !== path) {
      // No entry in the hash yet (mock default, or back from OAuth): put it
      // there, keeping only our own params (never an OAuth token hash).
      var p = C.parseHash(location.hash);
      history.replaceState(null, '', link({ tab: p.tab, research: p.research, decision: p.decision }));
    }
    return load().then(route);
  }

  function hashEntry() {
    return C.normalizeEntryPath(C.parseHash(location.hash).entry);
  }

  function boot() {
    var config = typeof CONFIG !== 'undefined' ? CONFIG : {};
    if (!config.SUPABASE_URL) {
      if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        document.getElementById('app').hidden = false;
        showMessage('Not configured', 'This site has no Supabase config.');
        return;
      }
      // Mock mode: fake data in memory, reset on reload. Never real data.
      document.getElementById('mock-banner').hidden = false;
      document.getElementById('logout-btn').hidden = true;
      start(MockClient.createMockClient(PlannerFixture.rows()), hashEntry() || PlannerFixture.ENTRY_PATH);
      return;
    }

    var db = supabase.createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY);
    document.getElementById('login-btn').addEventListener('click', function () {
      var entry = hashEntry();
      if (entry) sessionStorage.setItem(STASH_KEY, entry);
      db.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname },
      });
    });
    document.getElementById('logout-btn').addEventListener('click', function () {
      // 'local' ends only this browser's session; the default ('global')
      // would also revoke the CLI's refresh token in .env.
      db.auth.signOut({ scope: 'local' });
    });

    var started = false;
    db.auth.onAuthStateChange(function (event, session) {
      if (!session) {
        document.getElementById('app').hidden = true;
        document.getElementById('auth-section').hidden = false;
        return;
      }
      if (started) return;
      started = true;
      // Leave the auth callback before querying (supabase-js can deadlock on
      // calls made inside it).
      setTimeout(function () {
        var entry = hashEntry() || C.normalizeEntryPath(sessionStorage.getItem(STASH_KEY));
        sessionStorage.removeItem(STASH_KEY);
        if (!entry) {
          document.getElementById('auth-section').hidden = true;
          document.getElementById('app').hidden = false;
          showMessage('Which trip?', 'Open this page with the plan\'s knowledge entry in the URL.',
            'e.g. views/trip/#entry=travel/trips/<trip>/planner.md');
          return;
        }
        start(db, entry);
      }, 0);
    });
  }

  boot();
})();
