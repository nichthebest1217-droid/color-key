/* Harmony Color for printed music.
   The reader (reader.js) gives noteheads with their pitch and place, and the barlines. It does not read note values.
   This file makes the best timed sketch it can from the page's layout, the way a person skims a score: notes that stand
   in one upright line sound together; a bar runs from barline to barline; inside a bar, time runs with the distance
   along the staff, and the beats are laid over that. The sketch is handed to the same analyzer that reads MusicXML files
   (engine/colorkey.js), so the chords, keys and colors follow the same rules.
   It is a draft by design: where note values matter (a long note held under moving ones, an upbeat bar), it can be wrong. */
(function (root) {
  "use strict";
  var TICKS = 240;                                  // one bar, whatever its meter (divides by 1 to 6 beats)
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : 0; }

  /* ---------- the page as systems, bars and upright lines of notes ---------- */
  function layout(pages, skip) {
    var bars = [], systems = [], nStavesCount = {};
    pages.forEach(function (res, pi) {
      var bySystem = {};
      (res.staves || []).forEach(function (st) { (bySystem[st.system] = bySystem[st.system] || []).push(st); });
      Object.keys(bySystem).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sn) {
        var staves = bySystem[sn].slice().sort(function (a, b) { return a.top - b.top; });
        var space = median(staves.map(function (s) { return s.space; }));
        var rank = {}; staves.forEach(function (s, i) { rank[s.index] = i; });
        var heads = (res.notes || []).filter(function (n) { return n.system === sn && rank[n.staff] !== undefined && !(skip && skip(pi, n)); })
          .map(function (n) { return { x: n.x, y: n.y, s: rank[n.staff], note: n, page: pi }; });
        var rests = [], barX = [];
        staves.forEach(function (st, si) {
          (st.marks || []).forEach(function (m) {
            var kind = m.kind || m[0], x = m.x !== undefined ? m.x : m[1];
            if (kind === "rest") rests.push({ x: x, s: si });
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
            .concat(rests.filter(inside).map(function (r) { return { x: r.x, s: r.s, head: null }; }));
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
          var bar = { sys: sys, index: bars.length, xa: xa, xb: xb, cols: cols };
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
    var CK = root.ColorKey, lay = layout(pages);
    if (!lay.bars.length) return { ok: false, problem: "no bars found" };
    var guess = guessBeats(lay), how, beats;
    if (!opts.meter && opts.image && opts.tpl) {                      // look for a time signature at the start of the first page
      var sys0 = lay.systems.filter(function (sy) { return sy.page === 0; })[0];
      try { opts.meter = readMeter(root.ColorKeyReader, opts.image.gray, opts.image.w, opts.image.h, pages[0], opts.tpl, sys0 ? sys0.staves : null); } catch (e) { opts.meter = null; }
    }
    if (opts.meter && opts.meter.found && opts.meter.at && opts.meter.at.length) {
      // (0.1.1) what the reader marked as noteheads on the time signature itself are its numbers, not notes
      var at = opts.meter.at, isDigit = function (pi, n) { return pi === 0 && at.some(function (q) { return q.staff === n.staff && Math.abs(n.x - q.x) < 1.6 * q.space; }); };
      if (pages[0].notes.some(function (n) { return isDigit(0, n); })) { lay = layout(pages, isDigit); guess = guessBeats(lay); }
    }
    if (opts.beats) { beats = opts.beats; how = "set"; }
    else if (opts.meter && opts.meter.found) { beats = opts.meter.beats; how = "read"; }
    else { beats = guess.beats; how = "guessed"; }
    var pick = readWith(lay, beats, env);
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
      heads.push({ page: ref.head.page, x: n.x, y: n.y, space: n.space, note: n, span: si, hex: hex, family: famHex[String(hex).toUpperCase()] || (si >= 0 ? spans[si].family : "unknown") || "unknown", bar: ref.bar });
    });
    // each chord's name, written under its system where the chord begins
    var barLen = new CK.Frac(pick.beats, 1), labels = [], prevKey = null;
    spans.forEach(function (sp, i) {
      if (sp.status === "silent") return;
      var q = sp.start.num() / pick.beats, bi = Math.min(lay.bars.length - 1, Math.floor(q + 1e-9)), bar = lay.bars[bi];
      var tick = Math.round((q - bi) * TICKS), ci = 0;
      for (var c = 0; c < bar.cols.length; c++) if (bar.ticks[c] <= tick) ci = c;
      var changed = !!sp.key && sp.key.name !== prevKey;
      var text = sp.label ? CK.prettyAccidentals(sp.figure || "?").replace(" (cad)", "") : "?";
      labels.push({ span: i, page: bar.sys.page, sys: bar.sys, x: bar.cols[ci].x, text: text, prefix: changed ? CK.prettyPrefix(CK.keyPrefix(sp.key)) : null, unsure: !!(sp.label && sp.cueDegree), hex: sp.hex || env.lang.unknown.triad, bar: bi + 1 });
      if (sp.key) prevKey = sp.key.name;
    });
    var total = 0, unsure = 0; spans.forEach(function (sp) { if (sp.status === "silent") return; var d = sp.end.sub(sp.start).num(); total += d; if (!sp.label || sp.cueDegree) unsure += d; });
    return { ok: true, beats: pick.beats, chosen: how, meter: opts.meter || null, guess: guess,
      layout: lay, score: score, result: result, spans: spans, heads: heads, labels: labels, bars: lay.bars.length, chords: labels.length, unsure: total ? unsure / total : 0,
      keys: result.keys.map(function (k) { return { name: k.key ? k.key.name : null, bar: Math.floor(k.start.num() / pick.beats + 1e-9) + 1 }; }), report: colored.report };
  }

  root.ColorKeyReaderHarmony = { version: "0.1.1", read: read, layout: layout, timeBar: timeBar, sketch: sketch, loadMeter: loadMeter, readMeter: readMeter, guessBeats: guessBeats, TICKS: TICKS };
})(typeof window !== "undefined" ? window : globalThis);
