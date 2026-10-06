/* Harmony Color for printed music.
   The reader (reader.js) gives noteheads with their pitch and place, and the barlines. This file turns them into a timed
   sketch of the music and hands the sketch to the same analyzer that reads MusicXML files (engine/colorkey.js), so the
   chords, keys and colors follow the same rules.

   Two ways of timing a bar:
   1. From the note values (0.2.0). When every notehead and rest carries its written value (rhythm.js reads it from the
      stem, flags, beams and dots), the bar is counted the way a musician counts it: notes in one upright line start
      together; what follows in a staff starts where something before it in that staff ends; the staves have to agree, and
      the bar has to come out at its length. Triplets are found by that arithmetic. The length of the bars gives the meter.
   2. From the layout alone (0.1): time runs with the distance along the staff, and the beats are laid over that. It is
      used when no values are given, and for a bar whose values do not add up.
   Either way it is a draft: ties, grace notes, repeats and octave signs are not read. */
(function (root) {
  "use strict";
  var TICKS = 240;                                  // one bar, whatever its meter (divides by 1 to 6 beats)
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }

  /* ---------- the page as systems, bars and upright lines of notes ---------- */
  function layout(pages, skip, noValues) {
    var bars = [], systems = [], nStavesCount = {};
    pages.forEach(function (res, pi) {
      var bySystem = {};
      (res.staves || []).forEach(function (st) { (bySystem[st.system] = bySystem[st.system] || []).push(st); });
      Object.keys(bySystem).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sn) {
        var staves = bySystem[sn].slice().sort(function (a, b) { return a.top - b.top; });
        var space = median(staves.map(function (s) { return s.space; }));
        var rank = {}; staves.forEach(function (s, i) { rank[s.index] = i; });
        var heads = (res.notes || []).filter(function (n) { return n.system === sn && rank[n.staff] !== undefined && !(skip && skip(pi, n)) && !(!noValues && n.rv && n.rv.grace); })       // small notes are not counted in the bar
          .map(function (n) { return { x: n.x, y: n.y, s: rank[n.staff], note: n, page: pi }; });
        // small notes are kept aside: they are not counted, and take the color of the note they lean on
        var graces = noValues ? [] : (res.notes || []).filter(function (n) { return n.system === sn && rank[n.staff] !== undefined && n.rv && n.rv.grace && !(skip && skip(pi, n)); })
          .map(function (n) { return { x: n.x, y: n.y, s: rank[n.staff], note: n, page: pi }; });
        var rests = [], barX = [];
        staves.forEach(function (st, si) {
          (st.marks || []).forEach(function (m) {
            var kind = m.kind || m[0], x = m.x !== undefined ? m.x : m[1];
            if (kind === "rest") rests.push({ x: x, s: si, mark: m });
            else if (kind === "barline") barX.push({ x: x, s: si });
          });
        });
        // a barline of the system: seen at one place on most of its staves
        barX.sort(function (a, b) { return a.x - b.x; });
        var groups = [], need = Math.max(1, Math.ceil(staves.length * 0.6));
        barX.forEach(function (b) {
          var g = groups[groups.length - 1];
          if (g && b.x - g.x1 < 0.7 * space) { g.x1 = b.x; g.sum += b.x; g.n += 1; g.st[b.s] = 1; } else groups.push({ x1: b.x, sum: b.x, n: 1, st: (function () { var o = {}; o[b.s] = 1; return o; })() });
        });
        var lines = groups.filter(function (g) { return Object.keys(g.st).length >= need; }).map(function (g) { return g.sum / g.n; });
        var x0 = Math.min.apply(null, staves.map(function (s) { return s.x0; })), x1 = Math.max.apply(null, staves.map(function (s) { return s.x1; }));
        if (!lines.length || lines[0] - x0 > 1.5 * space) lines.unshift(x0);
        if (x1 - lines[lines.length - 1] > 1.5 * space) lines.push(x1);
        var sys = { page: pi, system: sn, staves: staves, space: space, x0: x0, x1: x1, bars: [], key: null };
        for (var k = 0; k < staves.length && sys.key === null; k++) if (staves[k].key !== null && staves[k].key !== undefined) sys.key = staves[k].key;
        nStavesCount[staves.length] = (nStavesCount[staves.length] || 0) + 1;
        for (var i = 0; i + 1 < lines.length; i++) {
          var xa = lines[i], xb = lines[i + 1];
          if (xb - xa < 2.5 * space) continue;                        // a double barline, or a sliver
          var inside = function (o) { return o.x > xa + 0.25 * space && o.x < xb - 0.25 * space; };
          var items = heads.filter(inside).map(function (h) { return { x: h.x, s: h.s, head: h }; })
            .concat(rests.filter(inside).map(function (r) { return { x: r.x, s: r.s, head: null, rest: r.mark }; }));
          if (!items.length) continue;                                // clef and key alone, or a courtesy signature at the line's end
          items.sort(function (a, b) { return a.x - b.x; });
          var cols = [];
          items.forEach(function (it) {
            var c = cols[cols.length - 1];
            if (c && it.x - c.xMax < 0.75 * space) { c.items.push(it); c.xMax = it.x; } else cols.push({ items: [it], xMin: it.x, xMax: it.x });
          });
          // a second inside a chord puts one notehead on the other side of the stem: still one upright line
          for (var c2 = cols.length - 1; c2 > 0; c2--) {
            var A = cols[c2 - 1], B = cols[c2];
            if (B.xMin - A.xMin < 1.35 * space && A.items.some(function (a) { return a.head && B.items.some(function (b) { return b.head && b.s === a.s && Math.abs(b.head.note.step - a.head.note.step) === 1; }); })) {
              A.items = A.items.concat(B.items); A.xMax = B.xMax; cols.splice(c2, 1);
            }
          }
          cols.forEach(function (c) { c.x = median(c.items.filter(function (q) { return q.head; }).map(function (q) { return q.x; }).concat(c.items.every(function (q) { return !q.head; }) ? c.items.map(function (q) { return q.x; }) : [])); });
          var bar = { sys: sys, index: bars.length, xa: xa, xb: xb, cols: cols, graces: graces.filter(function (g) { return g.x > xa && g.x <= xb; }) };
          sys.bars.push(bar); bars.push(bar);
        }
        systems.push(sys);
      });
    });
    var nStaves = +Object.keys(nStavesCount).sort(function (a, b) { return nStavesCount[b] - nStavesCount[a] || b - a; })[0] || 1;
    // A lone stretch of five lines that is shorter than the real systems, or that lies inside one, is not a line of music
    // (the reader sometimes takes ledger lines or beams for a staff). Its bars are left out.
    var full = systems.filter(function (sy) { return sy.staves.length === nStaves; });
    var width = median(full.map(function (sy) { return sy.x1 - sy.x0; }));
    var span = function (sy) { return [sy.staves[0].top, sy.staves[sy.staves.length - 1].top + 4 * sy.space]; };
    var dropped = 0;
    systems.forEach(function (sy) {
      if (sy.staves.length >= nStaves) return;
      var me = span(sy);
      var insideOther = full.some(function (o) { if (o.page !== sy.page) return false; var r = span(o); return me[0] < r[1] + 2 * o.space && me[1] > r[0] - 2 * o.space; });
      if (insideOther || (sy.x1 - sy.x0) < 0.85 * width) { sy.ghost = true; dropped += sy.bars.length; }
    });
    if (dropped) { bars = bars.filter(function (b) { return !b.sys.ghost; }); bars.forEach(function (b, i) { b.index = i; }); systems = systems.filter(function (sy) { return !sy.ghost; }); }
    return { bars: bars, systems: systems, nStaves: nStaves, ghostBars: dropped };
  }

  /* ---------- time inside a bar: distance along the staff, with the beats laid over it ---------- */
  function timeBar(bar, beats) {
    var cols = bar.cols, K = cols.length, sp = bar.sys.space;
    var xFirst = cols[0].x, xEnd = Math.max(bar.xb - 0.9 * sp, cols[K - 1].x + 1.2 * sp);
    var f = cols.map(function (c) { return Math.max(0, Math.min(0.985, (c.x - xFirst) / Math.max(1, xEnd - xFirst))); });
    var anchor = new Array(K).fill(null); anchor[0] = 0;
    var from = 1;
    for (var b = 1; b < beats; b++) {                                 // the upright line nearest each beat is that beat
      var target = b / beats, best = -1, bd = 0.42 / beats;
      for (var j = from; j < K; j++) { var d = Math.abs(f[j] - target); if (d < bd) { bd = d; best = j; } }
      if (best >= 0) { anchor[best] = Math.round(b * TICKS / beats); from = best + 1; }
    }
    var ticks = new Array(K), lastI = 0, lastT = 0, lastF = 0;
    for (var i = 0; i < K; i++) {
      if (anchor[i] !== null) { ticks[i] = anchor[i]; lastI = i; lastT = anchor[i]; lastF = f[i]; continue; }
      var nI = -1; for (var q = i + 1; q < K; q++) if (anchor[q] !== null) { nI = q; break; }
      var nT = nI >= 0 ? anchor[nI] : TICKS, nF = nI >= 0 ? f[nI] : 1;
      ticks[i] = Math.round(lastT + (nT - lastT) * (f[i] - lastF) / Math.max(1e-6, nF - lastF));
    }
    for (i = 1; i < K; i++) if (ticks[i] <= ticks[i - 1]) ticks[i] = ticks[i - 1] + 1;       // order on the page is order in time
    for (i = K - 1; i >= 0; i--) { var cap = TICKS - (K - i); if (ticks[i] > cap) ticks[i] = cap; }
    return ticks;
  }

  /* ---------- time inside a bar from the note values (0.2.0) ---------- */
  var Q = 480;                                      // ticks to a quarter note in this part of the file
  var VAL_TICKS = [1920, 960, 480, 240, 120, 60, 30];          // whole, half, quarter, eighth, 16th, 32nd, 64th
  function valueTicks(rv) {
    if (!rv || rv.value === null || rv.value === undefined || rv.value < 0) return null;
    var t = VAL_TICKS[rv.value]; return rv.dots === 1 ? t * 1.5 : rv.dots >= 2 ? Math.round(t * 1.75) : t;
  }
  function itemValue(it) { return valueTicks(it.head ? it.head.note.rv : (it.rest && it.rest.rv)); }
  function itemAlts(it) { var rv = it.head ? it.head.note.rv : (it.rest && it.rest.rv); return (rv && rv.alts) || []; }
  function hasValues(lay) {
    var n = 0, k = 0;
    lay.bars.forEach(function (bar) { bar.cols.forEach(function (c) { c.items.forEach(function (it) { n += 1; if (itemValue(it) !== null) k += 1; }); }); });
    return n > 0 && k >= 0.5 * n;
  }

  /* What starts where: for each upright line and staff, the notes or the rest that begin there, grouped by value.
     A whole rest alone on its staff fills the bar whatever the meter; it starts nothing and is left out. A mark whose
     value could not be read takes the value of what stands with it in the same upright line. */
  function barEvents(bar, unlike) {
    var perStaff = {};
    bar.cols.forEach(function (c) { c.items.forEach(function (it) { (perStaff[it.s] = perStaff[it.s] || []).push(it); }); });
    var isBarRest = function (it) { if (it.head || perStaff[it.s].length !== 1) return false; var rv = it.rest && it.rest.rv; return !rv || rv.value === 0 || rv.value === null || rv.value === undefined || rv.value < 0; };
    var cols = [], events = [];
    bar.cols.forEach(function (c, ci) {
      var items = c.items.filter(function (it) { return !isBarRest(it); });
      if (!items.length) return;
      var k = cols.length, groups = {}, known = {}, knownStaff = {}, onStem = {}, valueOf = new Map();
      var most = function (o) { var ks = Object.keys(o || {}); return ks.length ? +ks.sort(function (x, y) { return o[y] - o[x] || x - y; })[0] : null; };
      // noteheads of one staff on one stem are one chord and have one value: where the reading differs, the surest wins
      items.forEach(function (it) {
        var v = itemValue(it); valueOf.set(it, v);
        if (!it.head || v === null) return;
        var rv = it.head.note.rv, key = it.s + "|" + (rv.stem || 0); if (!rv.stem) return;
        (onStem[key] = onStem[key] || {})[v] = ((onStem[key] || {})[v] || 0) + (rv.sure === undefined ? 1 : rv.sure);
      });
      items.forEach(function (it) { var v = valueOf.get(it); if (!it.head || v === null) return; var rv = it.head.note.rv; if (rv.stem && onStem[it.s + "|" + rv.stem]) valueOf.set(it, most(onStem[it.s + "|" + rv.stem])); });
      items.forEach(function (it) { var v = valueOf.get(it); if (v !== null) { known[v] = (known[v] || 0) + 1; (knownStaff[it.s] = knownStaff[it.s] || {})[v] = ((knownStaff[it.s] || {})[v] || 0) + 1; } });
      cols.push({ ci: ci, x: c.x, events: [] });
      items.forEach(function (it) {
        var v = valueOf.get(it), guessed = false;
        if (v === null) { v = most(knownStaff[it.s]); if (v === null) v = most(known); guessed = v !== null; }
        var key = it.s + "|" + (v === null ? "?" : v); if (!groups[key]) groups[key] = { col: k, s: it.s, v: v, items: [], guessed: guessed }; groups[key].items.push(it);
      });
      Object.keys(groups).forEach(function (key) {
        var e = groups[key]; e.id = events.length; events.push(e); cols[k].events.push(e);
        // a second reading of the whole group: one that every mark of it allows (the network's next best answer), at the price of its doubt
        var share = null;
        e.items.forEach(function (it) {
          if (valueOf.get(it) !== e.v || e.guessed) return;             // a mark that took its value from its neighbours has no say
          var mine = {}; itemAlts(it).forEach(function (a) { var t = valueTicks(a); if (t !== null && t !== e.v) mine[t] = a.lp; });
          if (share === null) share = mine; else Object.keys(share).forEach(function (t) { if (mine[t] === undefined) delete share[t]; else share[t] = (share[t] + mine[t]); });
        });
        var nSay = e.items.filter(function (it) { return valueOf.get(it) === e.v; }).length || 1;
        e.alts = share ? Object.keys(share).map(function (t) { return { v: +t, cost: COST.altBase + COST.altDoubt * Math.min(4, share[t] / nSay) }; }) : [];
      });
    });
    // A triplet: three notes (or rests) of one value, one after the other in a staff, played in the time of two.
    // (Another voice of the staff may move beside them with another value, so the three are looked for among the marks
    // of one value; nothing else of the staff may start between them, only in their own upright lines.)
    var byValue = {}; events.forEach(function (e) { if (e.v !== null && e.v <= Q && e.v >= 60 && VAL_TICKS.indexOf(e.v) >= 0) (byValue[e.s + "|" + e.v] = byValue[e.s + "|" + e.v] || []).push(e); });
    Object.keys(byValue).forEach(function (key) {
      var list = byValue[key];
      for (var a = 0; a + 2 < list.length; a++) {
        var e0 = list[a], e1 = list[a + 1], e2 = list[a + 2];
        if (!(e0.col < e1.col && e1.col < e2.col)) continue;
        var between = events.some(function (o) { return o.s === e0.s && o.v !== e0.v && o.col > e0.col && o.col < e2.col && o.col !== e1.col; });
        if (!between) e0.triplet = [e0.id, e1.id, e2.id];
      }
    });
    // A triplet of unlike marks: together worth three of some value (an eighth, an eighth rest and two sixteenths; a
    // quarter and an eighth). In each upright line the staff's shortest mark is the one that moves.
    // NOT USED (2026-10-06): on the development pages it explained away more misreadings than it found triplets
    // (96.98% of noteheads at the right moment with it, 97.18% without), so the count is made without it and such
    // bars are left as bars that do not add up. Kept for a later look; timeBarValues(bar, L, null, true) turns it on.
    var byStaff = {};
    if (!unlike) return { cols: cols, events: events };
    cols.forEach(function (c) {
      var least = {};
      c.events.forEach(function (e) { if (e.v !== null && (!least[e.s] || e.v < least[e.s].v)) least[e.s] = e; });
      Object.keys(least).forEach(function (s) { (byStaff[s] = byStaff[s] || []).push(least[s]); });
    });
    Object.keys(byStaff).forEach(function (s) {
      var list = byStaff[s];
      for (var a = 0; a + 1 < list.length; a++) {
        if (list[a].triplet) continue;
        var sum = 0, ids = [], biggest = 0;
        for (var b = a; b < list.length && b < a + 6; b++) {
          var e = list[b];
          if (VAL_TICKS.indexOf(e.v) < 0 || e.v > 960) break;        // dotted marks do not stand in a triplet here
          sum += e.v; ids.push(e.id); if (e.v > biggest) biggest = e.v;
          var unit = sum / 3;
          if (ids.length >= 2 && (unit === 60 || unit === 120 || unit === 240 || unit === 480) && biggest <= 2 * unit) { list[a].triplet = ids.slice(); list[a].unlike = true; break; }
          if (sum >= 1440) break;
        }
      }
    });
    return { cols: cols, events: events };
  }

  /* The count of one bar. Every upright line gets its moment. A line may start where something earlier ends (in any
     staff), at the moment of the line before it (two voices set side by side), or a short step on (when a value was
     misread). Three notes of one value in a row may be taken as a triplet. Each choice is charged for what it breaks: a
     staff whose earlier notes do not end where its next ones start, a triplet, a staff that does not reach the bar's end
     or runs past it. The cheapest count wins. L: the bar's length in ticks when it is known; without it the staves only
     have to agree. */
  var COST = { tripletFirst: 0.5, tripletNext: 0.15, tripletUnlike: 0.45, gap: 1.0, overlap: 1.5, late: 0.5, same: 0.6, sameClose: 0.15, short: 0.7, long: 2.0, prior: 0.6, altBase: 0.6, altDoubt: 0.35 }, BEAM = 48;
  function timeBarValues(bar, L, dbg, unlike) {
    var be = barEvents(bar, unlike), cols = be.cols, events = be.events, K = cols.length, sp = bar.sys.space;
    var res = { ticks: bar.cols.map(function () { return 0; }), dur: new Map(), end: L || 0, cost: 0, viol: 0, agree: 0, staves: 0, cols: K, tuplets: 0, changed: 0, empty: !K };
    if (!K) return res;
    var xFirst = cols[0].x, xEnd = Math.max(bar.xb - 0.9 * sp, cols[K - 1].x + 1.2 * sp);
    var f = cols.map(function (c) { return Math.max(0, Math.min(1, (c.x - xFirst) / Math.max(1, xEnd - xFirst))); });
    var before = [], acc = {}, k, sKey;
    for (k = 0; k < K; k++) { var snap = {}; for (sKey in acc) snap[sKey] = acc[sKey].slice(); before.push(snap); cols[k].events.forEach(function (e) { (acc[e.s] = acc[e.s] || []).push(e); }); }
    // the least a staff still needs from each upright line on (a triplet takes two thirds): a count that must overrun the bar is set back at once
    var inTriplet = {}; events.forEach(function (e) { if (e.triplet) e.triplet.forEach(function (id) { inTriplet[id] = 1; }); });
    var need = cols.map(function () { return {}; });
    for (k = K - 1; k >= 0; k--) {
      var least = {};
      cols[k].events.forEach(function (e) { if (e.v === null) return; var m = inTriplet[e.id] ? e.v * 2 / 3 : e.v; e.alts.forEach(function (a) { if (a.v < m) m = a.v; }); if (least[e.s] === undefined || m < least[e.s]) least[e.s] = m; });
      for (sKey in (k + 1 < K ? need[k + 1] : {})) need[k][sKey] = need[k + 1][sKey];
      for (sKey in least) need[k][sKey] = (need[k][sKey] || 0) + least[sKey];
    }
    // two upright lines that may be one moment: voices of a staff on one pitch or a step apart, set side by side
    var closeTo = cols.map(function (c, kk) {
      if (!kk || c.x - cols[kk - 1].x > 1.5 * sp) return false;
      var A = bar.cols[cols[kk - 1].ci].items, B = bar.cols[c.ci].items;
      return A.some(function (a) { return a.head && B.some(function (b) { return b.head && b.s === a.s && Math.abs(b.head.note.step - a.head.note.step) <= 1; }); });
    });
    var hyps = [{ t: [0], d: events.map(function (e) { return e.v; }), tup: events.map(function () { return false; }), cost: 0, viol: 0, rank: 0, nTrip: {} }];
    for (k = 1; k < K; k++) {
      var next = [], seen = {};
      hyps.forEach(function (h) {
        var prev = h.t[k - 1], plain = {}, trip = {}, other = {};
        var add = function (c, e) { c = Math.round(c); if (c <= prev) return; if (!e) plain[c] = 1; else (trip[c] = trip[c] || []).push(e); };
        for (var i = 0; i < events.length; i++) {
          var e = events[i]; if (e.col >= k || h.d[i] === null) continue;
          add(h.t[e.col] + h.d[i], null);
          // a triplet may begin at e when its second note stands in this upright line
          if (e.triplet && events[e.triplet[1]].col === k && e.triplet.every(function (id) { return !h.tup[id]; })) add(h.t[e.col] + e.v * 2 / 3, e);
          // ... or e is worth what the network thought second most likely
          if (!h.tup[i] && e.alts.length) e.alts.forEach(function (a) { var c = Math.round(h.t[e.col] + a.v); if (c > prev) (other[c] = other[c] || []).push({ i: i, a: a }); });
        }
        [60, 120, 240, 480].forEach(function (g) { add(prev + g, null); });
        var times = Object.keys(plain).concat(Object.keys(trip), Object.keys(other)).map(Number).filter(function (c, i2, a2) { return a2.indexOf(c) === i2; }).sort(function (a, b) { return a - b; });
        if (L) times = times.filter(function (c) { return c < L; });
        times = times.slice(0, 10);
        var options = [];
        if (closeTo[k] || cols[k].x - cols[k - 1].x < 1.3 * sp) options.push({ c: prev, trip: null });
        times.forEach(function (c) {
          if (plain[c]) options.push({ c: c, trip: null }); if (trip[c]) options.push({ c: c, trip: trip[c] });
          if (other[c]) { var perEvent = {}; other[c].forEach(function (q) { if (!perEvent[q.i] || perEvent[q.i].a.cost > q.a.cost) perEvent[q.i] = q; }); options.push({ c: c, trip: null, alt: Object.keys(perEvent).map(function (i3) { return perEvent[i3]; }) }); }
        });
        options.forEach(function (q) {
          var c = q.c, d = h.d, tup = h.tup, cost = h.cost, nTrip = h.nTrip, viol = h.viol, ahead = 0;
          if (q.trip) {
            d = d.slice(); tup = tup.slice(); nTrip = Object.assign({}, nTrip);
            q.trip.forEach(function (e0) {
              e0.triplet.forEach(function (id) { d[id] = Math.round(events[id].v * 2 / 3); tup[id] = true; });
              cost += (nTrip[e0.s] ? COST.tripletNext : COST.tripletFirst) + (e0.unlike ? COST.tripletUnlike : 0); nTrip[e0.s] = (nTrip[e0.s] || 0) + 1;
            });
          }
          if (q.alt) { d = d.slice(); tup = tup.slice(); q.alt.forEach(function (x) { d[x.i] = x.a.v; tup[x.i] = 2; cost += x.a.cost; }); }
          if (c === prev) viol += closeTo[k] ? COST.sameClose : COST.same;       // two voices set side by side: cheap when they are a step apart or on one pitch
          var here = {}; cols[k].events.forEach(function (e) { here[e.s] = 1; });
          for (var s in here) {
            var bf = before[k][s];
            if (L && c + need[k][s] > L + 1) ahead += COST.long;
            var hit = false, later = false, known = false, any = false;
            for (var j = 0; bf && j < bf.length; j++) {
              if (h.t[bf[j].col] === c) continue;                    // another voice of the staff starting at this very moment
              any = true; var dd = d[bf[j].id]; if (dd === null) continue; known = true; var end = h.t[bf[j].col] + dd; if (end === c) hit = true; else if (end > c) later = true;
            }
            if (!any) { if (c > 0) viol += COST.late; continue; }
            if (known && !hit) viol += later ? COST.overlap : COST.gap;
          }
          if (L) cost += COST.prior * Math.abs(c / L - f[k]);
          cost += viol - h.viol;
          var t = h.t.concat([c]), key = t.join(",") + "|" + tup.map(function (b) { return +b; }).join("") + "|" + (q.alt ? d.join(",") : ""), nh = { t: t, d: d, tup: tup, cost: cost, viol: viol, rank: cost + ahead, nTrip: nTrip };
          if (seen[key] !== undefined) { if (next[seen[key]].cost > cost) next[seen[key]] = nh; return; }
          seen[key] = next.length; next.push(nh);
        });
      });
      if (!next.length) next = hyps.map(function (h) { return { t: h.t.concat([h.t[k - 1] + 60]), d: h.d, tup: h.tup, cost: h.cost + 3, viol: h.viol + 3, rank: h.rank + 3, nTrip: h.nTrip }; });
      next.sort(function (a, b) { return a.rank - b.rank; });
      hyps = next.slice(0, BEAM);
      if (dbg) dbg.push({ k: k, n: next.length, top: hyps.slice(0, 6).map(function (h) { return { t: h.t.slice(-3), cost: +h.cost.toFixed(2), trip: h.tup.filter(Boolean).length }; }) });
    }
    var finish = function (h) {
      var ends = {}, cost = h.cost, viol = h.viol;
      events.forEach(function (e, i) { if (h.d[i] === null) return; var end = h.t[e.col] + h.d[i]; if (ends[e.s] === undefined || end > ends[e.s]) ends[e.s] = end; });
      var vals = Object.keys(ends).map(function (s) { return ends[s]; }), target = L || 0;
      if (!L && vals.length) { var cnt = {}; vals.forEach(function (v) { cnt[v] = (cnt[v] || 0) + 1; }); target = +Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || b - a; })[0]; }
      var agree = 0, fix = null;
      Object.keys(ends).forEach(function (s) {
        var v = ends[s];
        if (v === target) { agree += 1; return; }
        var pen = v < target ? COST.short : COST.long + (v - target) / Q;
        // the staff's last mark, read the other way, may end exactly at the barline
        var last = [], cheapest = null;
        events.forEach(function (e, i) { if (String(e.s) === s && h.d[i] !== null && h.t[e.col] + h.d[i] === v) last.push(i); });
        var rest = 0; events.forEach(function (e, i) { if (String(e.s) === s && h.d[i] !== null && last.indexOf(i) < 0) rest = Math.max(rest, h.t[e.col] + h.d[i]); });
        if (target && last.length === 1 && !h.tup[last[0]] && rest <= target) events[last[0]].alts.forEach(function (a) { if (h.t[events[last[0]].col] + a.v === target && (!cheapest || a.cost < cheapest.cost)) cheapest = a; });
        if (cheapest && cheapest.cost < pen) { cost += cheapest.cost; agree += 1; (fix = fix || []).push({ i: last[0], v: cheapest.v }); }
        else { cost += pen; viol += pen; }
      });
      return { h: h, cost: cost, viol: viol, end: target, agree: agree, staves: vals.length, fix: fix };
    };
    var best = hyps.map(finish).sort(function (a, b) { return a.cost - b.cost; })[0], h = best.h, len = L || best.end || 0;
    if (best.fix) { h = { t: h.t, d: h.d.slice(), tup: h.tup.slice() }; best.fix.forEach(function (x) { h.d[x.i] = x.v; h.tup[x.i] = 2; }); }
    var lastT = h.t[K - 1];
    if (!len || len <= lastT) len = lastT + 120;
    cols.forEach(function (c, kk) { res.ticks[c.ci] = h.t[kk]; });
    events.forEach(function (e, i) {
      var d = h.d[i];
      if (d === null) { d = len - h.t[e.col]; for (var k2 = e.col + 1; k2 < K; k2++) if (cols[k2].events.some(function (o) { return o.s === e.s; })) { d = h.t[k2] - h.t[e.col]; break; } }
      d = Math.max(1, Math.min(d, len - h.t[e.col]));
      e.items.forEach(function (it) { res.dur.set(it, d); });
      if (h.tup[i] === true) res.tuplets += 1; else if (h.tup[i] === 2) res.changed += 1;
    });
    res.end = best.end; res.len = len; res.cost = best.cost; res.viol = best.viol; res.agree = best.agree; res.staves = best.staves;
    return res;
  }

  /* The meter from the lengths of the bars. First every bar is counted on its own; the commonest length among the bars
     whose staves agree is the bar of the piece. A change of meter is believed when the bars after it keep the new length.
     sig: the time signature read at the start of the first page, if one was ({ name: "3/4" }). */
  function sigTicks(name) {
    if (!name) return null;
    if (name === "C") return { n: 4, d: 4, len: 1920 }; if (/cut/i.test(name)) return { n: 2, d: 2, len: 1920 };
    var m = /^(\d+)\/(\d+)$/.exec(name); if (!m) return null;
    return { n: +m[1], d: +m[2], len: Math.round(+m[1] * 4 * Q / +m[2]) };
  }
  function meterName(len, compound) {
    var table = { 1920: [4, 4], 1440: compound ? [6, 8] : [3, 4], 960: [2, 4], 2880: compound ? [12, 8] : [6, 4], 720: [3, 8], 2160: [9, 8], 2400: [5, 4], 480: [1, 4], 1200: [5, 8], 1680: [7, 8], 3840: [4, 2], 3360: [7, 4] };
    if (table[len]) return table[len];
    var e = len / 240; if (Math.abs(e - Math.round(e)) < 1e-6 && e >= 1) return [Math.round(e), 8];
    var x = len / 120; return [Math.max(1, Math.round(x)), 16];
  }
  function beatsOf(n, d) { return (d === 8 && n % 3 === 0 && n > 3) ? n / 3 : n; }
  /* A bar whose count breaks rules is still counted: on the development pages the count of such a bar was right more often
     than its timing from the layout (with the network's values: 97.2% of noteheads at the right moment when every bar is
     counted, 97.1% when bars that break more than ACCEPT allows fall back to the layout; 77.8% against 75.9% in a font the
     reader does not know). opts.fallback turns the fallback on for trials. A bar that breaks rules is reported as such. */
  var ACCEPT = { base: 1.5, perLine: 0.25 };
  function planValues(lay, sig, opts) {
    opts = opts || {}; if (opts.always === undefined) opts.always = !opts.fallback;
    var first = lay.bars.map(function (bar) { var r = timeBarValues(bar, null); r.sure = !r.empty && r.viol < 0.75 && r.staves > 0 && r.agree === r.staves; return r; });
    var fits = function (r) { return r.viol <= ACCEPT.base + ACCEPT.perLine * r.cols; };
    var count = {}, sureIdx = [];
    first.forEach(function (r, i) { if (r.sure) { sureIdx.push(i); if (i > 0) count[r.end] = (count[r.end] || 0) + 1; } });
    var lens = Object.keys(count).map(Number).sort(function (a, b) { return count[b] - count[a]; });
    var st = sigTicks(sig && sig.found ? sig.name : null), early = sureIdx.filter(function (i) { return i > 0; }).slice(0, 12).map(function (i) { return first[i].end; });
    var cur = null, sigUsed = false;
    if (st && (early.indexOf(st.len) >= 0 || !early.length)) { cur = st.len; sigUsed = true; }
    else { for (var a = 0; a < early.length && cur === null; a++) if (early.indexOf(early[a], a + 1) >= 0) cur = early[a]; }
    if (cur === null) cur = lens.length ? lens[0] : (first[0] && first[0].sure ? first[0].end : (st ? st.len : 1920));     // a single bar on the page: its own length
    var mkRegion = function (from, len, sg) { return { from: from, len: len, sig: sg, name: sg ? [sg.n, sg.d] : meterName(len, false) }; };
    var regions = [mkRegion(0, cur, sigUsed ? st : null)], lenAt = [];
    for (var b = 0; b < lay.bars.length; b++) {
      var r = first[b];
      if (b > 0 && r.sure && r.end !== cur) {
        var ahead = sureIdx.filter(function (i) { return i > b; }).slice(0, 3), same = ahead.filter(function (i) { return first[i].end === r.end; }).length;
        // ... and when the bar cannot be counted in the meter so far (bars of triplets look half as long again, but they fit)
        if (ahead.length >= 2 && same >= 2 && !fits(timeBarValues(lay.bars[b], cur))) { cur = r.end; regions.push(mkRegion(b, cur, null)); }
      }
      lenAt.push(cur);
    }
    var bars = lay.bars.map(function (bar, b) {
      var L = lenAt[b], r1 = first[b], out;
      if (r1.empty) return { len: L, ticks: r1.ticks, dur: r1.dur, how: "empty", cost: 0, viol: 0, cols: 0 };
      if (b === 0 && r1.sure && r1.viol === 0 && r1.end < L) return { len: r1.end, ticks: r1.ticks, dur: r1.dur, how: "short", cost: r1.cost, viol: r1.viol, cols: r1.cols, tuplets: r1.tuplets };       // an upbeat (a short bar elsewhere keeps the full length: what it holds starts at the same moments either way)
      var r2 = timeBarValues(bar, L);
      if (fits(r2) || opts.always) return { len: L, ticks: r2.ticks, dur: r2.dur, how: "values", cost: r2.cost, viol: r2.viol, cols: r2.cols, tuplets: r2.tuplets, changed: r2.changed, broken: !fits(r2) };
      // the values do not add up: time from the layout, lengths from the values where there are any
      var reg = regions.filter(function (g) { return g.from <= b; }).pop(), nd = reg.name, lay240 = timeBar(bar, Math.max(1, Math.min(6, beatsOf(nd[0], nd[1])))), ticks = lay240.map(function (t) { return Math.round(t * L / TICKS); }), dur = new Map();
      bar.cols.forEach(function (c, ci) { c.items.forEach(function (it) {
        var v = itemValue(it), nextT = L; for (var k2 = ci + 1; k2 < bar.cols.length; k2++) if (bar.cols[k2].items.some(function (o) { return o.s === it.s; })) { nextT = ticks[k2]; break; }
        dur.set(it, Math.max(1, Math.min(v === null ? nextT - ticks[ci] : v, L - ticks[ci])));
      }); });
      return { len: L, ticks: ticks, dur: dur, how: "layout", cost: r2.cost, viol: r2.viol, cols: r2.cols };
    });
    // the name of each stretch: the signature that was read, or the length with the look of the beat (does the middle of the bar carry a beat, as in 6/8?)
    regions.forEach(function (g, gi) {
      var to = gi + 1 < regions.length ? regions[gi + 1].from : lay.bars.length, two = 0, three = 0, half = g.len / 2, third = g.len / 3;
      for (var b2 = g.from; b2 < to; b2++) {
        if (bars[b2].how !== "values") continue;
        var pb2 = bars[b2];
        lay.bars[b2].cols.forEach(function (c, ci) { c.items.forEach(function (it) {
          var t = pb2.ticks[ci], d = pb2.dur.get(it); if (!d) return;
          if (d === half && (t === 0 || t === half)) two += 1;                                   // a note as long as half the bar, on its halves: two beats of three
          if ((d === third && (t === third || t === 2 * third)) || (d === 2 * third && (t === 0 || t === third))) three += 1;      // a third of the bar, on its thirds: three beats
        }); });
      }
      g.compound = two > three; g.to = to;
      if (!g.sig) g.name = meterName(g.len, g.compound);
    });
    bars.forEach(function (pb, b) { var reg = regions.filter(function (g) { return g.from <= b; }).pop(); pb.meter = reg.from === b ? reg.name : null; pb.region = reg; });
    var how = { values: 0, short: 0, layout: 0, empty: 0, broken: 0 }; bars.forEach(function (pb) { how[pb.how] += 1; if (pb.broken) how.broken += 1; });      // broken: counted, but more rules were broken than a sound bar breaks
    return { bars: bars, regions: regions, how: how, first: first };
  }

  /* The sketch from the count: one part per staff, every note with its own start and length. */
  function sketchValues(lay, plan) {
    var nSt = lay.nStaves, refs = [], parts = [], s;
    for (s = 0; s < nSt; s++) parts.push([]);
    var lastKey = null;
    lay.bars.forEach(function (bar, bi) {
      var pb = plan.bars[bi], keyNow = bar.sys.key !== null ? bar.sys.key : lastKey;
      bar.t480 = pb.ticks; bar.len480 = pb.len;
      for (var s2 = 0; s2 < nSt; s2++) {
        var out = '<measure number="' + (bi + 1) + '">';
        if (bi === 0 || keyNow !== lastKey || pb.meter) out += "<attributes>" + (bi === 0 ? "<divisions>" + Q + "</divisions>" : "") + ((bi === 0 || keyNow !== lastKey) ? "<key><fifths>" + (keyNow || 0) + "</fifths></key>" : "") + (pb.meter ? "<time><beats>" + pb.meter[0] + "</beats><beat-type>" + pb.meter[1] + "</beat-type></time>" : "") + "</attributes>";
        var groups = {};
        bar.cols.forEach(function (c, ci) { c.items.forEach(function (it) {
          if (it.s !== s2 || !it.head) return;
          var t = pb.ticks[ci], d = pb.dur.get(it) || 1, key = t + "|" + d; (groups[key] = groups[key] || { t: t, d: d, heads: [] }).heads.push(it);
        }); });
        var list = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return a.t - b.t || b.d - a.d; }), pos = 0;
        list.forEach(function (g) {
          if (g.t > pos) out += "<forward><duration>" + (g.t - pos) + "</duration></forward>"; else if (g.t < pos) out += "<backup><duration>" + (pos - g.t) + "</duration></backup>";
          g.heads.forEach(function (q, k) {
            var n = q.head.note, id = refs.length; refs.push({ head: q.head, bar: bi, tick: g.t });
            out += '<note id="h' + id + '">' + (k ? "<chord/>" : "") + "<pitch><step>" + LETTERS[n.letter] + "</step>" + (n.alter ? "<alter>" + n.alter + "</alter>" : "") + "<octave>" + n.octave + "</octave></pitch><duration>" + g.d + "</duration><voice>1</voice></note>";
          });
          pos = g.t + g.d;
        });
        if (pos < pb.len) out += "<forward><duration>" + (pb.len - pos) + "</duration></forward>"; else if (pos > pb.len) out += "<backup><duration>" + (pos - pb.len) + "</duration></backup>";
        parts[s2].push(out + "</measure>");
      }
      lastKey = keyNow;
    });
    var xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>';
    for (s = 0; s < nSt; s++) xml += '<score-part id="P' + (s + 1) + '"><part-name>Staff ' + (s + 1) + "</part-name></score-part>";
    xml += "</part-list>";
    for (s = 0; s < nSt; s++) xml += '<part id="P' + (s + 1) + '">' + parts[s].join("") + "</part>";
    return { xml: xml + "</score-partwise>", refs: refs, divisions: Q };
  }

  /* ---------- the sketch as MusicXML, one part per staff ---------- */
  function sketch(lay, beats) {
    var nSt = lay.nStaves, div = TICKS / beats, refs = [], parts = [];
    for (var s = 0; s < nSt; s++) parts.push([]);
    var lastKey = null;
    lay.bars.forEach(function (bar, bi) {
      var ticks = timeBar(bar, beats); bar.ticks = ticks;
      var keyNow = bar.sys.key !== null ? bar.sys.key : lastKey;
      for (var s2 = 0; s2 < nSt; s2++) {
        var out = '<measure number="' + (bi + 1) + '">';
        if (bi === 0 || keyNow !== lastKey) out += "<attributes>" + (bi === 0 ? "<divisions>" + div + "</divisions>" : "") + "<key><fifths>" + (keyNow || 0) + "</fifths></key>" + (bi === 0 ? "<time><beats>" + beats + "</beats><beat-type>4</beat-type></time>" : "") + "</attributes>";
        var events = [];                                              // what this staff does in this bar, in order
        bar.cols.forEach(function (c, ci) {
          var hs = c.items.filter(function (q) { return q.s === s2 && q.head; }), rest = c.items.some(function (q) { return q.s === s2 && !q.head; });
          if (hs.length || rest) events.push({ t: ticks[ci], heads: hs });
        });
        var pos = 0;
        events.forEach(function (ev, ei) {
          if (!ev.heads.length) return;
          var next = ei + 1 < events.length ? events[ei + 1].t : TICKS;
          ev.heads.forEach(function (q, k) {
            var n = q.head.note, dur = next - ev.t;
            if (n.kind === "whole") dur = TICKS - ev.t;                // an open notehead is a long note: it keeps sounding under what follows
            else if (n.kind === "half") dur = Math.min(TICKS - ev.t, Math.max(dur, Math.round(2 * TICKS / beats)));
            if (dur < 1) dur = 1;
            if (k === 0) {
              if (ev.t > pos) out += "<forward><duration>" + (ev.t - pos) + "</duration></forward>";
              else if (ev.t < pos) out += "<backup><duration>" + (pos - ev.t) + "</duration></backup>";
              pos = ev.t + dur;                                        // only the first note of a chord moves the place in the bar
            }
            var id = refs.length; refs.push({ head: q.head, bar: bi, tick: ev.t });
            out += '<note id="h' + id + '">' + (k ? "<chord/>" : "") + "<pitch><step>" + LETTERS[n.letter] + "</step>" + (n.alter ? "<alter>" + n.alter + "</alter>" : "") + "<octave>" + n.octave + "</octave></pitch><duration>" + dur + "</duration><voice>1</voice></note>";
          });
        });
        if (pos < TICKS) out += "<forward><duration>" + (TICKS - pos) + "</duration></forward>";
        else if (pos > TICKS) out += "<backup><duration>" + (pos - TICKS) + "</duration></backup>";
        out += "</measure>";
        parts[s2].push(out);
      }
      lastKey = keyNow;
    });
    var xml = '<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list>';
    for (s = 0; s < nSt; s++) xml += '<score-part id="P' + (s + 1) + '"><part-name>Staff ' + (s + 1) + "</part-name></score-part>";
    xml += "</part-list>";
    for (s = 0; s < nSt; s++) xml += '<part id="P' + (s + 1) + '">' + parts[s].join("") + "</part>";
    xml += "</score-partwise>";
    return { xml: xml, refs: refs, divisions: div };
  }

  /* ---------- the meter: read the time signature, or failing that, judge from the layout ---------- */
  function loadMeter(json) {
    var W = json.width, r0 = json.rows[0], r1 = json.rows[1], H = r1 - r0, half = H >> 1;
    return { W: W, r0: r0, r1: r1, classes: json.classes.map(function (c) {
      var raw = c.pictures.map(function (b64) { var bin = atob(b64), v = new Float32Array(W * H); for (var i = 0; i < W * H; i++) v[i] = bin.charCodeAt(i) / 255; return v; });
      // the columns the signature itself fills (the staff lines fill every column alike)
      var col = new Float32Array(W), x, y, k;
      raw.forEach(function (v) { for (x = 0; x < W; x++) for (y = 0; y < H; y++) col[x] += v[y * W + x]; });
      var lo = Math.min.apply(null, col), hi = Math.max.apply(null, col), c0 = 0, c1 = W;
      for (x = 0; x < W; x++) if (col[x] - lo > 0.2 * (hi - lo)) { c0 = Math.max(0, x - 2); break; }
      for (x = W - 1; x >= 0; x--) if (col[x] - lo > 0.2 * (hi - lo)) { c1 = Math.min(W, x + 3); break; }
      var cut = function (v, ya, yb) {                                  // one half of a picture, mean taken out, length one
        var out = new Float32Array((yb - ya) * (c1 - c0)), i = 0, mean = 0;
        for (y = ya; y < yb; y++) for (x = c0; x < c1; x++) { out[i] = v[y * W + x]; mean += out[i++]; }
        mean /= out.length; var norm = 0; for (k = 0; k < out.length; k++) { out[k] -= mean; norm += out[k] * out[k]; }
        norm = Math.sqrt(norm) || 1; for (k = 0; k < out.length; k++) out[k] /= norm;
        return out;
      };
      return { name: c.name, beats: c.beats, c0: c0, c1: c1, half: half, top: raw.map(function (v) { return cut(v, 0, half); }), bottom: raw.map(function (v) { return cut(v, half, H); }) };
    }) };
  }
  /* Looks after the clef of each staff of the first system for a time signature: the band along the staff is compared,
     place by place, with small pictures of time signatures in several music fonts (reader/meter.json). The upper and the
     lower number are compared separately, so that 3/4 and 2/4 are not taken for each other because they share the 4.
     R: window.ColorKeyReader; gray: the page as gray bytes; page: the reader's result for that page. */
  function readMeter(R, gray, w, h, page, tpl, firstStaves) {
    if (!page.staves || !page.staves.length) return { found: false, why: "no staff" };
    var first = Math.min.apply(null, page.staves.map(function (q) { return q.system; }));
    var staves = firstStaves || page.staves.filter(function (st) { return st.system === first; });      // the first real line of music (not a stray staff)
    var W = tpl.W, H = tpl.r1 - tpl.r0, sum = tpl.classes.map(function () { return 0; }), used = 0, places = [];
    staves.forEach(function (st) {
      var st2 = { x0: st.x0, x1: st.x1, space: st.space, pts: [{ x: st.x0, y: st.top, space: st.space }, { x: st.x1, y: st.topEnd, space: st.space }] };
      var band = R.cutBand(gray, w, h, st2), bw = band.width, toU = function (x) { return (x - band.xLeft) / band.k; };
      var clefX = null, firstX = null, firstRest = null;
      (st.marks || []).forEach(function (m) {
        var kind = m.kind || m[0], x = m.x !== undefined ? m.x : m[1];
        if (/^clef/.test(kind) && (clefX === null || x < clefX)) clefX = x;
        if (kind === "rest" && (firstRest === null || x < firstRest)) firstRest = x;
      });
      // the search runs up to the first notehead; a "rest" before it may be the time signature itself (the reader was never
      // taught time signatures and sometimes takes the C for a rest), so rests only bound the search when the staff has no notes
      // (0.1.1) ... and only a notehead the reader is sure of bounds it: the round numbers of a time signature (6, 8, 9) can
      // look like faint noteheads
      (page.notes || []).forEach(function (nn) { if (nn.staff === st.index && nn.score >= 0.75 && (firstX === null || nn.x < firstX)) firstX = nn.x; });
      if (firstX === null) (page.notes || []).forEach(function (nn) { if (nn.staff === st.index && (firstX === null || nn.x < firstX)) firstX = nn.x; });
      if (firstX === null) firstX = firstRest;
      var uA = Math.round(clefX !== null ? toU(clefX) + 8 : toU(st.x0) + 20), uB = Math.round(firstX !== null ? toU(firstX) - 5 : uA + 110);
      uB = Math.min(uB, bw - 1, uA + 190);
      var best = tpl.classes.map(function () { return -1; }), where = tpl.classes.map(function () { return null; });
      tpl.classes.forEach(function (cl, ci) {
        var cw = cl.c1 - cl.c0, n = cl.half * cw, win = new Float32Array(n);
        var halfScore = function (u, rowA, pics) {                    // the band under this half of the picture, against every font's picture
          var mean = 0, i = 0, r, c;
          for (r = 0; r < cl.half; r++) for (c = 0; c < cw; c++) { var v = band.data[(rowA + r) * bw + u + c]; win[i++] = v; mean += v; }
          mean /= n; var norm = 0; for (i = 0; i < n; i++) { win[i] -= mean; norm += win[i] * win[i]; }
          if (norm < 1e-6) return pics.map(function () { return 0; });
          norm = Math.sqrt(norm);
          return pics.map(function (t) { var d = 0; for (var q = 0; q < n; q++) d += win[q] * t[q]; return d / norm; });
        };
        for (var u = uA; u + cw <= uB; u++) {
          var tops = halfScore(u, tpl.r0, cl.top), bots = halfScore(u, tpl.r0 + cl.half, cl.bottom);
          for (var p = 0; p < tops.length; p++) { var sc = Math.min(tops[p], bots[p]) * 0.5 + (tops[p] + bots[p]) * 0.25; if (sc > best[ci]) { best[ci] = sc; where[ci] = band.xLeft + (u + cw / 2) * band.k; } }
        }
      });
      if (best.some(function (b) { return b > -1; })) { best.forEach(function (b, ci) { sum[ci] += Math.max(b, 0); }); used += 1; places.push({ staff: st.index, space: st.space, where: where }); }
    });
    if (!used) return { found: false, why: "no room for a time signature after the clef" };
    var scored = tpl.classes.map(function (cl, ci) { return { name: cl.name, beats: cl.beats, score: sum[ci] / used, ci: ci }; }).sort(function (a, b) { return b.score - a.score; });
    var top = scored[0], rival = scored.filter(function (x) { return x.beats !== top.beats; })[0];
    var found = top.score >= METER_MIN && (!rival || top.score - rival.score >= METER_GAP);
    return { found: found, name: top.name, beats: top.beats, score: top.score, gap: rival ? top.score - rival.score : 1, scored: scored.slice(0, 4).map(function (q) { return { name: q.name, beats: q.beats, score: q.score }; }),
      at: found ? places.map(function (pl) { return { staff: pl.staff, space: pl.space, x: pl.where[top.ci] }; }).filter(function (q) { return q.x !== null; }) : [] };
  }
  var METER_MIN = 0.75, METER_GAP = 0.02;      // chosen on the 72 training engravings: the best picture was the right one in 71; one page gave none
  /* Without a time signature: do the upright lines of notes fall on thirds of the bar, or on quarters? */
  function guessBeats(lay) {
    var fit = { 3: 0, 4: 0 }, n = 0;
    lay.bars.forEach(function (bar) {
      var cols = bar.cols, K = cols.length; if (K < 3) return;
      var sp = bar.sys.space, xFirst = cols[0].x, xEnd = Math.max(bar.xb - 0.9 * sp, cols[K - 1].x + 1.2 * sp);
      var f = cols.map(function (c) { return (c.x - xFirst) / Math.max(1, xEnd - xFirst); });
      [3, 4].forEach(function (B) {
        var hits = 0;
        for (var b = 1; b < B; b++) { var t = b / B; if (f.some(function (x) { return Math.abs(x - t) <= 0.2 / B; })) hits += 1; }
        fit[B] += hits / (B - 1);
      });
      n += 1;
    });
    if (!n) return { beats: 4, fit3: 0, fit4: 0 };
    return { beats: fit[3] / n - fit[4] / n > 0.1 ? 3 : 4, fit3: fit[3] / n, fit4: fit[4] / n };
  }

  /* ---------- read the sketch with the page's own analyzer ---------- */
  function readWith(lay, beats, env) {
    var CK = root.ColorKey, sk = sketch(lay, beats);
    var score = CK.readScore(sk.xml);
    var result = CK.analyze(score, env.dict, Object.assign({ backoff: true, keyStartPrior: true, confidentFrequency: 0.7 }, env.prog ? { progression: env.prog } : {}));
    var total = 0, sure = 0;
    result.spans.forEach(function (sp) {
      if (sp.status === "silent") return;
      var d = sp.end.sub(sp.start).num(); total += d; if (sp.label && !sp.cueDegree) sure += d;
    });
    return { beats: beats, score: score, result: result, sketch: sk, sure: total ? sure / total : 0, chords: result.spans.filter(function (sp) { return sp.status !== "silent"; }).length };
  }

  /* The whole reading. env: { dict, prog, lang }. opts.beats: 1 to 4, or nothing to let the page choose the count of beats
     under which most of the music gets a reading it is sure of. */
  function read(pages, env, opts) {
    opts = opts || {};
    var useValues = !opts.beats && opts.values !== false;
    var CK = root.ColorKey, lay = layout(pages, null, !useValues);
    if (!lay.bars.length) return { ok: false, problem: "no bars found" };
    var guess = guessBeats(lay), how, beats;
    if (!opts.meter && opts.image && opts.tpl) {                      // look for a time signature at the start of the first page
      var sys0 = lay.systems.filter(function (sy) { return sy.page === 0; })[0];
      try { opts.meter = readMeter(root.ColorKeyReader, opts.image.gray, opts.image.w, opts.image.h, pages[0], opts.tpl, sys0 ? sys0.staves : null); } catch (e) { opts.meter = null; }
    }
    if (opts.meter && opts.meter.found && opts.meter.at && opts.meter.at.length) {
      // (0.1.1) what the reader marked as noteheads on the time signature itself are its numbers, not notes
      var at = opts.meter.at, isDigit = function (pi, n) { return pi === 0 && at.some(function (q) { return q.staff === n.staff && Math.abs(n.x - q.x) < 1.6 * q.space; }); };
      if (pages[0].notes.some(function (n) { return isDigit(0, n); })) { lay = layout(pages, isDigit, !useValues); guess = guessBeats(lay); }
    }
    var pick, plan = null;
    if (useValues && hasValues(lay)) {                                // the note values were read: count the bars
      plan = planValues(lay, opts.meter, { fallback: opts.fallback });
      var sk = sketchValues(lay, plan), sc = CK.readScore(sk.xml);
      var rs = CK.analyze(sc, env.dict, Object.assign({ backoff: true, keyStartPrior: true, confidentFrequency: 0.7 }, env.prog ? { progression: env.prog } : {}));
      var nd0 = plan.regions[0].name; beats = beatsOf(nd0[0], nd0[1]); how = "counted";
      pick = { beats: beats, score: sc, result: rs, sketch: sk };
    } else {
      if (opts.beats) { beats = opts.beats; how = "set"; }
      else if (opts.meter && opts.meter.found) { beats = opts.meter.beats; how = "read"; }
      else { beats = guess.beats; how = "guessed"; }
      pick = readWith(lay, beats, env);
      lay.bars.forEach(function (bar) { bar.t480 = bar.ticks.map(function (t) { return t * beats * Q / TICKS; }); bar.len480 = beats * Q; });
    }
    var score = pick.score, result = pick.result, spans = result.spans;
    var colored = CK.colorScoreKey(score, spans, env.lang, { locale: "en", cues: false, labels: false, legend: false });
    var doc = new DOMParser().parseFromString(colored.xmlText, "application/xml"), hexOf = {};
    Array.prototype.forEach.call(doc.getElementsByTagName("note"), function (el) { var id = el.getAttribute("id"); if (id) hexOf[id] = el.getAttribute("color"); });
    // each notehead: its chord and its color
    var starts = spans.map(function (sp) { return sp.start; });
    function spanAt(t) { var lo = 0, hi = starts.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (starts[mid].le(t)) lo = mid + 1; else hi = mid; } var i = lo - 1; return (i >= 0 && spans[i].start.le(t) && t.lt(spans[i].end)) ? i : -1; }
    var famHex = {}; env.lang.families.forEach(function (f) { famHex[f.triad.toUpperCase()] = f.id; famHex[f.seventh.toUpperCase()] = f.id; });
    var heads = [];
    score.notation.forEach(function (r) {
      if (r.isRest || !r.el) return;
      var id = r.el.getAttribute("id"); if (!id) return;
      var ref = pick.sketch.refs[+id.slice(1)], si = spanAt(r.onset), hex = hexOf[id] || env.lang.unknown.triad;
      var n = ref.head.note;
      heads.push({ page: ref.head.page, x: n.x, y: n.y, space: n.space, note: n, span: si, hex: hex, family: famHex[String(hex).toUpperCase()] || (si >= 0 ? spans[si].family : "unknown") || "unknown", bar: ref.bar, tick: ref.tick });
    });
    // a small note takes the color of the note it leans on: the nearest notehead of the next upright line, in its own staff if there is one
    var byNote = new Map(); heads.forEach(function (h) { byNote.set(h.note, h); });
    lay.bars.forEach(function (bar, bi) {
      (bar.graces || []).forEach(function (g) {
        var ci = bar.cols.length - 1; for (var c = 0; c < bar.cols.length; c++) if (bar.cols[c].x > g.x - 0.2 * bar.sys.space) { ci = c; break; }
        var cands = bar.cols[ci].items.filter(function (it) { return it.head && byNote.has(it.head.note); });
        if (!cands.length) return;
        cands.sort(function (a, b) { return (a.s === g.s ? 0 : 1) - (b.s === g.s ? 0 : 1) || Math.abs(a.head.y - g.y) - Math.abs(b.head.y - g.y); });
        var on = byNote.get(cands[0].head.note);
        heads.push({ page: g.page, x: g.x, y: g.y, space: g.note.space, note: g.note, span: on.span, hex: on.hex, family: on.family, bar: bi, tick: on.tick, grace: true });
      });
    });
    // each chord's name, written under its system where the chord begins
    var labels = [], prevKey = null, mStart = score.measures.map(function (m) { return m.start.num(); });
    var barAt = function (t) { var lo = 0, hi = mStart.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (mStart[mid] <= t + 1e-9) lo = mid + 1; else hi = mid; } return Math.max(0, Math.min(lay.bars.length - 1, lo - 1)); };
    spans.forEach(function (sp, i) {
      if (sp.status === "silent") return;
      var t0 = sp.start.num(), bi = barAt(t0), bar = lay.bars[bi];
      var tick = Math.round((t0 - (mStart[bi] || 0)) * Q), ci = 0;
      for (var c = 0; c < bar.cols.length; c++) if (bar.t480[c] <= tick) ci = c;
      var changed = !!sp.key && sp.key.name !== prevKey;
      var text = sp.label ? CK.prettyAccidentals(sp.figure || "?").replace(" (cad)", "") : "?";
      labels.push({ span: i, page: bar.sys.page, sys: bar.sys, x: bar.cols[ci].x, text: text, prefix: changed ? CK.prettyPrefix(CK.keyPrefix(sp.key)) : null, unsure: !!(sp.label && sp.cueDegree), hex: sp.hex || env.lang.unknown.triad, bar: bi + 1 });
      if (sp.key) prevKey = sp.key.name;
    });
    var total = 0, unsure = 0; spans.forEach(function (sp) { if (sp.status === "silent") return; var d = sp.end.sub(sp.start).num(); total += d; if (!sp.label || sp.cueDegree) unsure += d; });
    return { ok: true, beats: pick.beats, chosen: how, meter: opts.meter || null, guess: guess,
      layout: lay, score: score, result: result, spans: spans, heads: heads, labels: labels, bars: lay.bars.length, chords: labels.length, unsure: total ? unsure / total : 0,
      rhythm: plan ? { how: plan.how, meters: plan.regions.map(function (g) { return { bar: g.from + 1, name: g.name[0] + "/" + g.name[1], read: !!g.sig }; }), plan: plan } : null,
      keys: result.keys.map(function (k) { return { name: k.key ? k.key.name : null, bar: barAt(k.start.num()) + 1 }; }), report: colored.report };
  }

  root.ColorKeyReaderHarmony = { version: "0.2.0", read: read, layout: layout, timeBar: timeBar, sketch: sketch, loadMeter: loadMeter, readMeter: readMeter, guessBeats: guessBeats, TICKS: TICKS,
    timeBarValues: timeBarValues, planValues: planValues, sketchValues: sketchValues, hasValues: hasValues, valueTicks: valueTicks, Q: Q, COST: COST };
})(typeof window !== "undefined" ? window : globalThis);
