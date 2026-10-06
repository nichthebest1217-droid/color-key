/* Color Key: the second reading. Every chord is named by rule (its notes stacked in thirds), beside the first reading,
   which looks the chord up among expert-labeled examples. Port of src/colorkey/second.py (protocol p9-second-reading-v1,
   rules T0-T9 in that file's docstring); web/test_second.html checks that both give the same output on every corpus
   movement. Integers and exact fractions only; nothing is counted or fitted.

   Loads after colorkey.js and uses window.ColorKey (Frac, parseInput, familyOf, labelParts, prettyAccidentals, isSeventh,
   DEFAULT_ASSIGN); nothing of any page.

     CKSecond.read(score, result, language, options)   one record per result.spans[i], ready to print (sentences in English)
     CKSecond.summary(readings)                        counts and the phrase for the facts line
     CKSecond.isPublishedTable(language)               false when the chord-to-color table is not the published one
     CKSecond.attach(score, result, familyOf)          the core records (identical to Python): readings, relations, spans

   ruleReading(mode, notes, bass): notes = [[degree, alteration, ticks]], bass = [degree, alteration] or null.

   VERSION is the rule set the registered run measured (p9-20261005a) and does not move with the wording. WORDING counts
   revisions of the English sentences and of the page records only: 2 = after the review of 2026-10-05 (a supplied note is
   said to come from the key only when it does; "the notes" in the augmented-sixth sentence; what the rule does with a
   diminished chord, not what the music does; where a diminished chord's color comes from; a line when two readings of
   the same chord print different numerals; every bar a chord covers that fits one scale, counted once). */
(function (global) {
  "use strict";
  const VERSION = "1.0.0", WORDING = 2;
  const BLEND = [3, 1], RARE_COST = 1, RARE = ["aug", "aug7", "augM7", "mM7"];
  const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  const TRIAD_Q = { "4,7": "M", "3,7": "m", "3,6": "dim", "4,8": "aug" };
  const SEVENTH_Q = { "4,7,10": "Mm7", "4,7,11": "MM7", "3,7,10": "mm7", "3,7,11": "mM7", "3,6,9": "dim7", "3,6,10": "hdim7", "4,8,10": "aug7", "4,8,11": "augM7" };
  const DIM = ["dim", "dim7", "hdim7"];
  const APPLIED_SEVENTH = { major: { "1+0": [4, 0], "2+0": [5, 0], "3+0": [6, 0], "6+0": [2, 0], "7+0": [3, 0] },
                            minor: { "1+0": [4, 0], "2+0": [5, 0], "3+0": [6, 0], "4+0": [7, 0], "7+0": [3, 0] } };
  const APPLIED_TRIAD = { major: { "2+0": [5, 0], "3+0": [6, 0], "6+0": [2, 0], "7+0": [3, 0] }, minor: { "2+0": [5, 0] } };
  const TARGET_UPPER = { major: { 1: true, 2: false, 3: false, 4: true, 5: true, 6: false, 7: false }, minor: { 1: false, 2: false, 3: true, 4: false, 5: true, 6: true, 7: true } };
  const NAT = ["1+0", "2+0", "3+0", "4+0", "5+0", "6+0", "7+0"];
  const KEYNOTES = { major: new Set(NAT), minor: new Set(NAT.concat(["6+1", "7+1"])) };
  const PARALLEL = { major: new Set(NAT.concat(["3-1", "6-1", "7-1"])), minor: new Set(["1+0", "2+0", "3+1", "4+0", "5+0", "6+1", "7+1"]) };
  const RELATIONS = ["same-name", "same-color", "differ", "not-compared", "examples-only", "rule-only", "neither"];   // order of `shares`
  const mod = (a, n) => ((a % n) + n) % n;
  const relPc = (mode, d, a) => mod(SCALE[mode][d - 1] + a, 12);
  const up = (d, k) => mod(d - 1 + k, 7) + 1;
  const supplyAlt = (mode, d) => (mode === "minor" && d === 7) ? 1 : 0;
  const fmt = x => x[0] + (x[1] >= 0 ? "+" + x[1] : String(x[1]));
  const cmpTuple = (x, y) => { for (let i = 0; i < x.length; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; };
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const r = a % b; a = b; b = r; } return a || 1; }
  // durations: [[degree, alteration, numerator, denominator]] -> [[degree, alteration, ticks]] on the least common denominator
  function ticksFromDurations(durations) {
    let den = 1; for (const x of durations) den = den / gcd(den, x[3]) * x[3];
    return durations.map(x => [x[0], x[1], x[2] * (den / x[3])]).sort(cmpTuple);
  }

  // ------------------------------------------------------------------ the tonal reading (rules T0-T9)
  function ruleReading(mode, notesIn, bassIn) {
    const notes = notesIn.map(x => [x[0], x[1], x[2]]).sort(cmpTuple);                      // T0: normal form
    const order = notes.map(x => [x[0], x[1]]);
    const t = new Map(notes.map(x => [fmt(x), x[2]]));
    if (t.size !== order.length) throw new Error("duplicate note in the input of ruleReading");
    for (const x of notes) if (!(x[2] > 0)) throw new Error("ticks must be positive");
    const bass = (bassIn === null || bassIn === undefined) ? null : [bassIn[0], bassIn[1]];
    const n = order.length;
    let Wr = 0; for (const x of notes) Wr += x[2];
    if (n === 0) return { kind: "none", codes: ["silent"], n: 0 };
    if (n === 1) return { kind: "none", codes: ["one-note"], n: 1 };                        // T1
    const u = new Map(notes.map(x => [fmt(x), BLEND[0] * n * x[2] + BLEND[1] * Wr]));       // T2: blended weight
    let U = 0; for (const v of u.values()) U += v;
    const pc = new Map(order.map(x => [fmt(x), relPc(mode, x[0], x[1])]));
    const same = (x, y) => x !== null && y !== null && x[0] === y[0] && x[1] === y[1];
    const cands = [];
    function pick(root, k, allowed) {
      const letter = up(root[0], k); let best = null;
      for (const x of order) {
        if (x[0] !== letter) continue;
        const iv = mod(pc.get(fmt(x)) - pc.get(fmt(root)), 12);
        if (!allowed.includes(iv)) continue;
        const key = [-u.get(fmt(x)), Math.abs(x[1]), x[1]];
        if (best === null || cmpTuple(key, best[0]) < 0) best = [key, x, iv];
      }
      return best ? [best[1], best[2]] : [null, null];
    }
    const scaleInterval = (root, k) => { const letter = up(root[0], k); return mod(relPc(mode, letter, supplyAlt(mode, letter)) - pc.get(fmt(root)), 12); };
    if (n === 2 && same(order[0], [3, 0]) && same(order[1], [5, 0])) {                     // T5: the tonic dyad
      cands.push({ type: "tertian", root: [1, 0], q: mode === "major" ? "M" : "m", members: [[1, 0], [3, 0], [5, 0]], tones: [[3, 0], [5, 0]],
                   missing: 1, with7: false, Uc: U, X: n * U - U, rootless: true });
    } else {
      for (const root of order) {                                                           // T3: tertian candidates
        const [third, tIv0] = pick(root, 2, [3, 4]);
        const [fifth, fIv0] = pick(root, 4, [6, 7, 8]);
        const [seventh, sIv] = pick(root, 6, [9, 10, 11]);
        if (third === null && fifth === null) continue;
        const missing = (third === null ? 1 : 0) + (fifth === null ? 1 : 0);
        let tIv = tIv0, fIv = fIv0;
        if (third === null) { const iv = scaleInterval(root, 2); tIv = (iv === 3 || iv === 4) ? iv : (root[1] > 0 ? 3 : 4); }
        if (fifth === null) { const iv = scaleInterval(root, 4); fIv = (iv === 6 || iv === 7) ? iv : 7; if (fIv === 6 && tIv === 4) fIv = 7; }
        for (const with7 of [false, true]) {
          if (with7 && seventh === null) continue;
          const q = with7 ? SEVENTH_Q[tIv + "," + fIv + "," + sIv] : TRIAD_Q[tIv + "," + fIv];
          if (q === undefined) continue;
          const members = with7 ? [root, third, fifth, seventh] : [root, third, fifth];
          const tones = members.filter(m => m !== null);
          let Uc = 0; for (const m of tones) Uc += u.get(fmt(m));
          const cost = missing + (with7 ? 1 : 0) + (RARE.includes(q) ? RARE_COST : 0);
          cands.push({ type: "tertian", root, q, members, tones, missing, with7, Uc, X: n * (2 * Uc - U) - U * cost, rootless: false });
        }
      }
      const b6 = [6, mode === "major" ? -1 : 0], s4 = [4, 1], t1 = [1, 0], b3 = [3, mode === "major" ? -1 : 0], d2 = [2, 0];
      if (u.has(fmt(b6)) && u.has(fmt(s4)) && u.has(fmt(t1))) {                             // T4: augmented sixths
        const forms = [["It6", [s4, b6, t1], [4, 1], 0]];
        if (u.has(fmt(b3))) forms.push(["Ger6", [s4, b6, t1, b3], [4, 1], 1]);
        if (u.has(fmt(d2))) forms.push(["Fr6", [d2, s4, b6, t1], [2, 0], 1]);
        for (const [q, members, root, extra] of forms) {
          let Uc = 0; for (const m of members) Uc += u.get(fmt(m));
          cands.push({ type: "aug6", root, q, members, tones: members.slice(), missing: 0, with7: !!extra, Uc, X: n * (2 * Uc - U) - U * extra, rootless: false });
        }
      }
    }
    if (!cands.length) return { kind: "none", codes: ["no-third-or-fifth"], n };
    for (const c of cands) {                                                                // T6: choice
      let inv = null;
      if (bass !== null) c.members.forEach((m, i) => { if (inv === null && same(m, bass)) inv = i; });
      c.inv = inv;
      c.rank = [-c.X, inv !== null ? 0 : 1, (bass !== null && same(c.root, bass)) ? 0 : 1, c.missing, c.with7 ? 1 : 0, c.type === "aug6" ? 0 : 1,
                -(u.get(fmt(c.root)) || 0), Math.abs(c.root[1]), c.root[0], c.root[1]];
    }
    cands.sort((x, y) => cmpTuple(x.rank, y.rank));
    const best = cands[0];
    let covered = 0; for (const m of best.tones) covered += t.get(fmt(m));
    if (best.X <= 0) return { kind: "none", codes: ["not-tertian"], n, closest: { root: fmt(best.root), quality: best.q, covered: [covered, Wr] } };   // T7: acceptance
    const root = best.root, q = best.q, inv = best.inv, rk = fmt(root);
    let deg = root, chain = "", tags = "";
    const codes = [];
    const leading = mode === "major" ? [7, 0] : [7, 1];
    if (best.type === "aug6") { tags = "aug6:" + q.slice(0, -1); codes.push("aug6"); }                                                                  // T8: role
    else if (q === "Mm7" && APPLIED_SEVENTH[mode][rk]) { deg = [5, 0]; chain = fmt(APPLIED_SEVENTH[mode][rk]); codes.push("applied-seventh"); }
    else if (q === "M" && APPLIED_TRIAD[mode][rk]) { deg = [5, 0]; chain = fmt(APPLIED_TRIAD[mode][rk]); codes.push("applied-triad"); }
    else if (DIM.includes(q) && !same(root, [2, 0]) && !same(root, leading)) {
      const above = up(root[0], 1);
      if (relPc(mode, above, 0) === mod(pc.get(rk) + 1, 12) && above !== 1) { deg = [7, TARGET_UPPER[mode][above] ? 0 : 1]; chain = fmt([above, 0]); codes.push("applied-leading"); }
    }
    else if (same(root, [2, -1])) codes.push("flat-two");
    if (!codes.length && best.type === "tertian") {                                         // T8f: notes outside the key
      const names = best.tones.map(fmt);
      if (names.some(x => !KEYNOTES[mode].has(x))) codes.push(names.every(x => PARALLEL[mode].has(x)) ? "borrowed" : "outside-key");
    }
    if (best.rootless) codes.push("tonic-dyad");
    codes.push(best.missing ? "incomplete" : "complete");
    if (best.with7 && best.type !== "aug6") codes.push("seventh");
    const other = order.filter(x => !best.tones.some(m => same(m, x)));
    if (other.length) codes.push("other-notes");
    if (bass === null) codes.push("no-bass"); else if (inv === null) codes.push("bass-outside");
    const label = "root=" + rk + ";rpc=" + relPc(mode, root[0], root[1]) + ";q=" + q + ";inv=" + (inv === null ? 0 : inv) + ";ext=;add=;omit=;deg=" + fmt(deg) + ";chain=" + chain + ";tags=" + tags;   // T9
    const roles = best.type === "tertian" ? ["root", "third", "fifth", "seventh"] : ["", "", "", ""];
    return { kind: "chord", n, label, root: rk, quality: q, inversion: inv, type: best.type,
             members: best.members.map((m, i) => ({ role: roles[i], note: m === null ? null : fmt(m), sounds: m !== null && t.has(fmt(m)) })),
             other: other.map(fmt), covered: [covered, Wr], X: best.X, codes };
  }

  // one line per reading: the form the Python / JavaScript equality check compares
  function serialize(r) {
    if (r === null || r === undefined) return "-";
    if (r.kind === "none") { const c = r.closest; return "none|" + r.codes.join(",") + "|" + r.n + (c ? "|" + c.root + "," + c.quality + "," + c.covered[0] + "/" + c.covered[1] : ""); }
    return ["chord", r.label, r.inversion === null ? "?" : String(r.inversion), r.type,
            r.members.map(m => m.role + ":" + (m.note || "-") + (m.sounds ? "" : "*")).join(","), r.other.join(","), r.covered[0] + "/" + r.covered[1], String(r.X), r.codes.join(",")].join("|");
  }

  // ------------------------------------------------------------------ the two readings side by side
  function fieldsOf(label) { const f = {}; for (const part of label.split(";")) { const i = part.indexOf("="); f[part.slice(0, i)] = part.slice(i + 1); } return f; }
  // familyOf(label, mode): the function that colors the first reading (ColorKey.familyOf with the page's table bound in)
  function relation(label1, mode, reading, familyOf, status) {
    if (status === "silent" || status === "no_key" || reading === null || reading === undefined) return null;
    const chord = reading.kind === "chord";
    if (!label1) return chord ? "rule-only" : "neither";
    if (!chord) return "examples-only";
    if (reading.codes.includes("bass-outside")) return "not-compared";
    if (familyOf(label1, mode) !== familyOf(reading.label, mode)) return "differ";
    const f = fieldsOf(label1);
    return (f.root === reading.root && f.q === reading.quality && reading.inversion !== null && f.inv === String(reading.inversion)) ? "same-name" : "same-color";
  }

  // ------------------------------------------------------------------ collections (bar level): the registered rules in exact arithmetic
  const MODE_INTERVALS = { 1: [2, 2, 2, 2, 2, 2], 2: [1, 2, 1, 2, 1, 2, 1, 2], 3: [2, 1, 1, 2, 1, 1, 2, 1, 1], 4: [1, 1, 3, 1, 1, 1, 3, 1], 5: [1, 4, 1, 1, 4, 1], 6: [2, 2, 1, 1, 2, 2, 1, 1], 7: [1, 1, 1, 2, 1, 1, 1, 1, 2, 1] };
  const MAJOR = [2, 2, 1, 2, 2, 2, 1];
  function pcsOf(steps, start) { const s = new Array(12).fill(false); let p = mod(start, 12); for (const st of steps) { s[p] = true; p = mod(p + st, 12); } return s; }
  const COLLECTIONS = [];
  for (let m = 1; m <= 7; m++) { const seen = new Set(); for (let st = 0; st < 12; st++) { const s = pcsOf(MODE_INTERVALS[m], st), k = s.map(x => x ? 1 : 0).join(""); if (!seen.has(k)) { seen.add(k); COLLECTIONS.push({ kind: "mode", mode: m, transposition: st + 1, pcs: s, size: s.filter(Boolean).length, key: k }); } } }
  for (let st = 0; st < 12; st++) { const s = pcsOf(MAJOR, st); COLLECTIONS.push({ kind: "diatonic", mode: 0, transposition: st + 1, pcs: s, size: 7, key: s.map(x => x ? 1 : 0).join("") }); }
  // weights: 12 non-negative integers (ticks per pitch class). C4 = (19, 20), C3 = (1, 1).
  function collectionOfBar(weights, num, den) {
    if (num === undefined) { num = 19; den = 20; }
    let total = 0, present = 0; for (let p = 0; p < 12; p++) { total += weights[p]; if (weights[p] > 0) present += 1; }
    if (total <= 0) return { label: "empty" };
    const cover = COLLECTIONS.filter(c => { let inside = 0; for (let p = 0; p < 12; p++) if (c.pcs[p]) inside += weights[p]; return inside * den >= total * num; });
    if (!cover.length) return { label: "none" };
    const size = Math.min(...cover.map(c => c.size)), small = cover.filter(c => c.size === size);
    if (present < 5 || small.length > 1) return { label: "ambiguous" };
    const c = small[0];
    if (c.kind === "diatonic") return { label: "diatonic", transposition: c.transposition, key: c.key };
    let sounding = 0; for (let p = 0; p < 12; p++) if (c.pcs[p] && weights[p] > 0) sounding += 1;
    if (sounding < c.size - 1) return { label: "ambiguous" };
    return { label: "mode " + c.mode, transposition: c.transposition, key: c.key };
  }
  function collectionShown(weights) {
    const a = collectionOfBar(weights, 19, 20), b = collectionOfBar(weights, 1, 1);
    if ((a.label === "mode 1" || a.label === "mode 2") && a.label === b.label && a.key === b.key) {
      const pcs = []; for (let p = 0; p < 12; p++) if (a.key[p] === "1") pcs.push(p);
      return { name: a.label === "mode 1" ? "whole-tone" : "octatonic", pcs };
    }
    return null;
  }

  // ------------------------------------------------------------------ from a score (events with exact start, end and a spelled pitch)
  const CK = () => global.ColorKey;
  const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }, STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }, STEPS = "CDEFGAB";
  // the engine's own definition (colorkey.js does not export it); the check in segmentNotes catches any drift
  function spelledFeature(p, key) {
    const degree = mod(STEP_INDEX[p.step] - STEP_INDEX[key.tonicStep], 7) + 1;
    return [degree, mod(p.pc - mod(key.tonicPc + SCALE[key.mode][degree - 1], 12) + 6, 12) - 6];
  }
  // events sorted by start, with the running maximum of their ends: every event that sounds inside [a, b)
  const INDEX = new WeakMap();
  function soundIndex(score) {
    let ix = INDEX.get(score.sounding);
    if (!ix) {
      const events = score.sounding.slice().sort((x, y) => x.start.cmp(y.start)), maxend = []; let m = null;
      for (const e of events) { m = (m === null || e.end.gt(m)) ? e.end : m; maxend.push(m); }
      ix = { events, maxend }; INDEX.set(score.sounding, ix);
    }
    return ix;
  }
  function overlapping(ix, a, b) {
    let lo = 0, hi = ix.maxend.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ix.maxend[mid].le(a)) lo = mid + 1; else hi = mid; }
    let lo2 = 0, hi2 = ix.events.length; while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (ix.events[mid].start.lt(b)) lo2 = mid + 1; else hi2 = mid; }
    const out = []; for (let i = lo; i < lo2; i++) if (ix.events[i].end.gt(a)) out.push(ix.events[i]);
    return out;
  }
  const lesser = (x, y) => x.le(y) ? x : y, greater = (x, y) => x.ge(y) ? x : y;
  // { mode, notes, bass } for ruleReading. The note set and the bass are the first reading's own (info.input); only the
  // durations are swept from the score. A swept note set that is not the input's is a programming error.
  function segmentNotes(score, a, b, key, info) {
    const inp = CK().parseInput(info.input), dur = new Map();
    for (const e of overlapping(soundIndex(score), a, b)) {
      const f = spelledFeature(e.pitch, key), k = fmt(f), w = lesser(e.end, b).sub(greater(e.start, a)), cur = dur.get(k);
      if (cur) cur.w = cur.w.add(w); else dur.set(k, { f, w });
    }
    const want = new Set(inp.feats.map(fmt));
    if (want.size !== dur.size || [...dur.keys()].some(k => !want.has(k))) throw new Error("second reading: the notes swept from the score (" + [...dur.keys()].join(",") + ") are not the first reading's (" + [...want].join(",") + ") at " + a.str());
    return { mode: inp.mode, notes: ticksFromDurations([...dur.values()].map(x => [x.f[0], x.f[1], x.w.n, x.w.d])), bass: inp.bass };
  }
  // one rule reading per raw segment of the first reading (null for a silent segment or one without a key)
  function readSegments(score, result) {
    return result.raw.map(r => {
      if (r.info.status === "silent" || r.info.status === "no_key" || !r.key) return null;
      const s = segmentNotes(score, r.start, r.end, r.key, r.info);
      return ruleReading(s.mode, s.notes, s.bass);
    });
  }
  // items: [[duration (Frac), relation]] of one chord's segments, in order -> [relation, index of the representative].
  // The class with the most duration wins; ties go to the more cautious class. See span_relation in second.py.
  function spanRelation(items) {
    const zero = new (CK().Frac)(0, 1), cls = r => (r === "same-name" || r === "same-color") ? "agree" : r;
    const labeled = items.some(x => ["same-name", "same-color", "differ", "not-compared", "examples-only"].includes(x[1]));
    const order = labeled ? ["differ", "not-compared", "examples-only", "agree"] : ["neither", "rule-only"];
    const dur = new Map();
    for (const [d, r] of items) if (r !== null) dur.set(cls(r), (dur.get(cls(r)) || zero).add(d));
    if (!dur.size) return [null, null];
    let win = order[0];
    for (const c of order) if ((dur.get(c) || zero).gt(dur.get(win) || zero)) win = c;
    if (win === "agree") {
      let sn = zero, sc = zero;
      for (const [d, r] of items) { if (r === "same-name") sn = sn.add(d); else if (r === "same-color") sc = sc.add(d); }
      win = sn.ge(sc) ? "same-name" : "same-color";
    }
    let rep = null;
    items.forEach((x, i) => { if (x[1] === win && (rep === null || x[0].gt(items[rep][0]))) rep = i; });
    return [win, rep];
  }
  // sounding duration of each pitch class inside the bar, as 12 non-negative integers on the bar's least common denominator
  function barWeights(score, measure) {
    const zero = new (CK().Frac)(0, 1), w = []; for (let p = 0; p < 12; p++) w.push(zero);
    for (const e of overlapping(soundIndex(score), measure.start, measure.end)) {
      const d = lesser(e.end, measure.end).sub(greater(e.start, measure.start));
      if (d.gt(zero)) w[e.pitch.pc] = w[e.pitch.pc].add(d);
    }
    let den = 1; for (const v of w) den = den / gcd(den, v.d) * v.d;
    return w.map(v => v.n * (den / v.d));
  }
  const barReadings = score => score.measures.map(m => collectionShown(barWeights(score, m)));
  // every bar a chord covers that says something: the bar holding its start and each later bar that starts inside it (for
  // the page; the compared record keeps the first one only, see barOfSpan)
  function barsOfSpan(score, bars, start, end) {
    const out = []; if (!score.measures.length) return out;
    const first = measureAt(score, start);
    for (let i = first; i < score.measures.length && (i === first || score.measures[i].start.lt(end)); i++)
      if (bars[i]) out.push({ index: score.measures[i].index, name: bars[i].name, pcs: bars[i].pcs.slice() });
    return out;
  }
  function measureAt(score, t) { let lo = 0, hi = score.measures.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (score.measures[mid].start.le(t)) lo = mid + 1; else hi = mid; } return Math.max(0, lo - 1); }
  // the bar holding the chord's start; if that bar says nothing, the first later bar that starts inside the chord and says something
  function barOfSpan(score, bars, start, end) {
    if (!score.measures.length) return null;
    let i = measureAt(score, start);
    for (;;) {
      if (bars[i]) return { index: score.measures[i].index, name: bars[i].name, pcs: bars[i].pcs.slice() };
      i += 1;
      if (i >= score.measures.length || !score.measures[i].start.lt(end)) return null;
    }
  }
  // The core records, identical to Python (second.read_segments, second.relation, second.read_spans):
  //   readings[i], relations[i] per result.raw[i];  spans[j] = { relation, rep, segments, shares, bar } per result.spans[j]
  // and bars[k] per score.measures[k]: the bar reading (collectionShown) or null, for the page's own use (barsOfSpan)
  function attach(score, result, familyOf) {
    const zero = new (CK().Frac)(0, 1), raw = result.raw;
    const readings = readSegments(score, result);
    const relations = raw.map((r, i) => relation(r.label, r.key ? r.key.mode : null, readings[i], familyOf, r.info.status));
    const bars = barReadings(score);
    let j = 0;
    const spans = result.spans.map(sp => {
      while (j < raw.length && raw[j].start.lt(sp.start)) j += 1;
      const seg = []; while (j < raw.length && raw[j].start.lt(sp.end)) { seg.push(j); j += 1; }
      const [rel, rep] = spanRelation(seg.map(i => [raw[i].end.sub(raw[i].start), relations[i]]));
      const shares = RELATIONS.map(() => zero);
      for (const i of seg) if (relations[i] !== null) { const k = RELATIONS.indexOf(relations[i]); shares[k] = shares[k].add(raw[i].end.sub(raw[i].start)); }
      return { relation: rel, rep: rep === null ? null : seg[rep], segments: seg, shares: shares.map(x => x.str()), bar: barOfSpan(score, bars, sp.start, sp.end) };
    });
    return { readings, relations, spans, bars };
  }
  // one line per chord for the equality check: relation | representative | shares | bar
  function spanLine(rec) {
    return [rec.relation || "-", rec.rep === null ? "-" : String(rec.rep), rec.shares.join(","), rec.bar ? rec.bar.name + ":" + rec.bar.pcs.join(",") : "-"].join("|");
  }

  // ------------------------------------------------------------------ the reason in English (JavaScript only; Python stops at codes)
  const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
  const SIGN = { "-2": "𝄫", "-1": "♭", "0": "", "1": "♯", "2": "𝄪" };
  const PLAIN = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  const QUALITY_WORDS = { M: "a major triad", m: "a minor triad", dim: "a diminished triad", aug: "an augmented triad",
    Mm7: "a dominant seventh (a major triad with a minor seventh)", MM7: "a major seventh chord", mm7: "a minor seventh chord", mM7: "a minor triad with a major seventh",
    dim7: "a diminished seventh chord", hdim7: "a half-diminished seventh chord", aug7: "an augmented triad with a minor seventh", augM7: "an augmented triad with a major seventh",
    It6: "an Italian sixth", Ger6: "a German sixth", Fr6: "a French sixth" };
  const QUALITY_INTERVALS = { M: [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], Mm7: [0, 4, 7, 10], MM7: [0, 4, 7, 11], mm7: [0, 3, 7, 10], mM7: [0, 3, 7, 11],
    dim7: [0, 3, 6, 9], hdim7: [0, 3, 6, 10], aug7: [0, 4, 8, 10], augM7: [0, 4, 8, 11] };
  const INTERVAL_WORDS = { 3: "a minor third", 4: "a major third", 6: "a diminished fifth", 7: "a perfect fifth", 8: "an augmented fifth" };
  const DIM_COLOR_LINE = "Its color is the page's color for a diminished chord on any degree other than the second and the leading tone.";
  const BAR_END = " A fit, not a proof.";
  const CHIPS = { "same-name": "Two readings agree", "same-color": "Same color, different name", "differ": "Two readings differ", "not-compared": "Not compared",
                  "examples-only": "One reading", "rule-only": "One reading", "neither": "No chord reading" };
  const SHARED_LINE = "Both readings use the key, the chord boundaries and the note spelling the page found. If the key is wrong, both are wrong together.";
  const pair = s => [parseInt(s[0], 10), parseInt(s.slice(1), 10)];                         // "4+1" -> [4, 1]
  const listOf = xs => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
  // the name of the note on degree d (its letter) at pitch class `rel` above the tonic; never an accidental beyond double
  function nameOn(key, d, rel) {
    const letter = STEPS[mod(STEP_INDEX[key.tonicStep] + d - 1, 7)], pcAbs = mod(key.tonicPc + rel, 12), acc = mod(pcAbs - STEP_PC[letter] + 6, 12) - 6;
    return (acc >= -2 && acc <= 2) ? letter + SIGN[String(acc)] : PLAIN[pcAbs];
  }
  const noteName = (key, x) => nameOn(key, x[0], relPc(key.mode, x[0], x[1]));
  const degreeWords = x => x[1] === 0 ? "the " + ORDINAL[x[0]] + " degree" : x[1] === 1 ? "the raised " + ORDINAL[x[0]] + " degree" : x[1] === -1 ? "the lowered " + ORDINAL[x[0]] + " degree" : "an altered " + ORDINAL[x[0]] + " degree";
  const keyWords = (key, mode) => key.tonicStep + (SIGN[String(key.tonicAlter)] || "") + " " + (mode || key.mode);
  // the numeral as the score's labels print it: accidentals pretty, the diminished sign as a degree sign, then figures, additions, target
  function numeral(label, mode) {
    const p = CK().labelParts(label, mode); if (!p) return "?";
    return CK().prettyAccidentals((p.special || (p.acc + p.numeral + (p.quality || "").replace("o", "°"))) + p.figures.join("") + p.adds + p.target);
  }
  // letters of a segment's notes, from the bass upward by letter: "G B D F, G in the bass"
  function notesWords(key, inp, withBass) {
    const from = inp.bass ? inp.bass[0] : 1;
    const names = inp.feats.slice().sort((x, y) => (mod(x[0] - from, 7) - mod(y[0] - from, 7)) || (x[1] - y[1])).map(x => noteName(key, x));
    return names.join(" ") + (withBass && inp.bass ? ", " + noteName(key, inp.bass) + " in the bass" : "");
  }
  // rd: a rule reading; key: the tracked key of its segment; inp: { feats, bass } of its segment (ColorKey.parseInput)
  function sentences(rd, key, inp) {
    const mode = key.mode, N = x => noteName(key, x), out = [];
    if (rd.kind !== "chord") {
      if (rd.codes.includes("one-note")) out.push("Only one note name sounds here (" + (inp.feats.length ? N(inp.feats[0]) : "?") + "). One note does not make a chord.");
      else if (rd.codes.includes("no-third-or-fifth")) out.push("No two of these notes lie a third or a fifth apart, so they do not stack into a chord.");
      else if (rd.codes.includes("not-tertian")) out.push("No chord built in thirds holds enough of what sounds here. The closest is " + QUALITY_WORDS[rd.closest.quality] + " on " + N(pair(rd.closest.root)) + ".");
      else out.push("No note sounds here.");
      return out;
    }
    const root = pair(rd.root), sounding = rd.members.filter(m => m.sounds).map(m => N(pair(m.note))), others = rd.other.map(x => N(pair(x)));
    const dyad = rd.codes.includes("tonic-dyad"), aug6 = rd.type === "aug6";
    if (dyad) out.push("Only " + N([3, 0]) + " and " + N([5, 0]) + " sound. The rule reads the third and fifth degrees alone as the tonic chord without its root.");
    else if (aug6) {
      const b6 = [6, mode === "major" ? -1 : 0], s4 = [4, 1], rest = rd.members.map(m => m.note).filter(x => x !== fmt(b6) && x !== fmt(s4)).map(x => N(pair(x)));
      out.push((others.length ? "Leaving out " + listOf(others) + ", the notes " : "") + N(b6) + " and " + N(s4) + " lie an augmented sixth apart and both lead to " + N([5, 0]) + ", the fifth degree. With " +
               listOf(rest) + " this is " + QUALITY_WORDS[rd.quality] + ".");
    } else {
      const lead = others.length ? "Leaving out " + listOf(others) + ", the notes " : "";
      if (rd.codes.includes("incomplete")) {
        const k = rd.members.findIndex(m => !m.sounds);                                     // 1 the third, 2 the fifth
        const letter = up(root[0], 2 * k), rootPc = relPc(mode, root[0], root[1]), iv = QUALITY_INTERVALS[rd.quality][k], missing = nameOn(key, letter, rootPc + iv);
        // rule T3 takes the scale's note on that letter when it makes a third or a fifth; otherwise it assumes one, and that note is not the key's
        const fromKey = mod(relPc(mode, letter, supplyAlt(mode, letter)) - rootPc, 12) === iv;
        out.push(lead + listOf(sounding) + " fit " + QUALITY_WORDS[rd.quality] + " on " + N(root) + " with its " + rd.members[k].role + " missing; the rule " +
                 (fromKey ? "takes " + missing + " from the key." : "assumes " + INTERVAL_WORDS[iv] + ", " + missing + "."));
      } else out.push(lead + sounding.join("–") + " stack in thirds on " + N(root) + ": " + QUALITY_WORDS[rd.quality] + ".");
    }
    if (!dyad && !aug6) {                                                                   // the role
      const num = numeral(rd.label, mode), chain = fieldsOf(rd.label).chain;
      const outside = rd.members.filter(m => m.sounds && !KEYNOTES[mode].has(m.note)).map(m => N(pair(m.note))), verb = outside.length === 1 ? "is" : "are";
      if (rd.codes.includes("applied-seventh") || rd.codes.includes("applied-triad"))
        out.push(N(root) + " is not the fifth degree of " + keyWords(key) + ", so the chord is read as the dominant of the note a fifth below, " + N(pair(chain)) + ", " + degreeWords(pair(chain)) + ": " + num + ".");
      else if (rd.codes.includes("applied-leading"))
        out.push("The rule reads a " + (rd.quality === "hdim7" ? "half-diminished" : "diminished") + " chord as the leading-tone chord of the note a half step above its root, here " +
                 N(pair(chain)) + ", " + degreeWords(pair(chain)) + ": " + num + ".");
      else if (rd.codes.includes("flat-two")) out.push("It stands on the lowered second degree: the Neapolitan, " + num + ".");
      else if (rd.codes.includes("borrowed"))
        out.push(listOf(outside) + " " + verb + " not in " + keyWords(key) + " but " + verb + " in " + keyWords(key, mode === "major" ? "minor" : "major") + ": a chord borrowed from the " +
                 (mode === "major" ? "minor" : "major") + " mode. By its root it is " + num + ".");
      else if (rd.codes.includes("outside-key"))
        out.push(listOf(outside) + " " + verb + " outside " + keyWords(key) + ", and no rule here names this chord's role. By its root, " + degreeWords(root) + ", it is " + num + ".");
      else out.push(N(root) + " is " + degreeWords(root) + " of " + keyWords(key) + ", so this is " + num + ".");
    }
    const bass = inp.bass || (rd.inversion !== null ? pair(rd.members[rd.inversion].note) : null);   // the bass
    if (rd.codes.includes("no-bass") || !bass) out.push("No note is sounding at the bottom when this chord begins, so the inversion is left open.");
    else if (rd.codes.includes("bass-outside")) out.push("The lowest note, " + N(bass) + ", is not part of this chord. It may be a held bass note, so the two readings are not compared here.");
    else if (aug6) out.push(N(bass) + " is in the bass.");
    else if (rd.inversion === 0) out.push("The root is in the bass.");
    else out.push(N(bass) + ", the " + ["root", "third", "fifth", "seventh"][rd.inversion] + ", is in the bass: " + ["", "first", "second", "third"][rd.inversion] + " inversion.");
    return out;
  }
  function placeOf(score, t) {                                                              // { bar: printed number, beat: 1, 2, ... } of a moment
    const m = score.measures[measureAt(score, t)]; if (!m) return { bar: "?", beat: 1 };
    const parts = String(m.meter || "4/4").split("/").map(x => parseInt(x, 10)), num = parts[0] || 4, den = parts[1] || 4;
    const F = CK().Frac, step = (den === 8 && num % 3 === 0 && num > 3) ? new F(3, 2) : new F(4, den);
    const lead = (m.isPickup && m.meterQuarters) ? m.meterQuarters.sub(m.end.sub(m.start)) : new F(0, 1);      // an upbeat bar is counted from where its first beat would be
    const q = t.sub(m.start).add(lead);
    return { bar: m.printedNumber || String(m.index), beat: Math.floor((q.n * step.d) / (q.d * step.n)) + 1 };
  }
  // the bar sentence: the scale's notes ascending from C in the bar's own spelling; a note that does not sound in parentheses.
  // here: the index of the bar the chord begins in; a bar that is not that one is named by its number instead of "this bar"
  function barWords(score, rec, here) {
    const m = score.measures.find(x => x.index === rec.index), zero = new (CK().Frac)(0, 1), spell = new Map();
    for (const e of overlapping(soundIndex(score), m.start, m.end)) {
      const d = lesser(e.end, m.end).sub(greater(e.start, m.start)); if (!d.gt(zero)) continue;
      const k = e.pitch.pc + "|" + e.pitch.step + "|" + e.pitch.alter, cur = spell.get(k);
      if (cur) cur.d = cur.d.add(d); else spell.set(k, { pc: e.pitch.pc, step: e.pitch.step, alter: e.pitch.alter, d });
    }
    const notes = rec.pcs.map(pcAbs => {
      const c = [...spell.values()].filter(x => x.pc === pcAbs).sort((x, y) => y.d.cmp(x.d) || (Math.abs(x.alter) - Math.abs(y.alter)) || (x.alter - y.alter) || (x.step < y.step ? -1 : 1));
      if (!c.length) return "(" + PLAIN[pcAbs] + ")";
      return SIGN[String(c[0].alter)] === undefined ? PLAIN[pcAbs] : c[0].step + SIGN[String(c[0].alter)];
    });
    const number = m.printedNumber || String(m.index), which = (here === undefined || here === null || here === rec.index) ? "this bar" : "bar " + number;
    return { index: rec.index, number, name: rec.name, notes, sentence: "Every note of " + which + " belongs to one " + rec.name + " scale: " + notes.join(" ") + "." + BAR_END };
  }
  // a chord the visitor corrected (its color, its text, a taught reading, or joined to the chord before) is not compared
  const corrected = s => !!(s.familyOverride || s.textOverride || (s.seventhOverride !== undefined && s.seventhOverride !== null) || s.taught || s.corrected || s.continuation);

  // One record per result.spans[i] (section 7 of the specification). Changes nothing in score, result or language.
  // options.collection: true lets the bar sentence through (bar is null and bars is empty otherwise). bars holds every bar the
  // chord covers that fits one scale; bar is the first of them, and its sentence names them all when there are several.
  function read(score, result, language, options) {
    const lang = language || {}, opt = options || {}, C = CK(), assign = lang.assign || C.DEFAULT_ASSIGN;
    const familyOf = (label, mode) => C.familyOf(label, mode, assign);
    const core = attach(score, result, familyOf), raw = result.raw;
    const byId = {}; for (const f of (lang.families || [])) byId[f.id] = f;
    const nameOfFamily = f => !f ? "" : (f.plain && f.plain.en) || (f.term && f.term.en) || f.id || "";
    const words = i => notesWords(raw[i].key, C.parseInput(raw[i].info.input), true);
    return result.spans.map((s, i) => {
      const rec = core.spans[i], seg = rec.segments, first = seg.length ? raw[seg[0]] : null;
      const silent = s.status === "silent" || !first || first.info.status === "silent";
      const live = !silent && !!s.key && rec.relation !== null && !corrected(s);
      const here = score.measures.length ? score.measures[measureAt(score, s.start)].index : null;
      const bars = (opt.collection && !silent) ? barsOfSpan(score, core.bars, s.start, s.end).map(b => barWords(score, b, here)) : [];
      const bar = !bars.length ? null : bars.length === 1 ? bars[0] : Object.assign({}, bars[0], { sentence: bars.map(b => b.sentence.slice(0, -BAR_END.length)).join(" ") + BAR_END });
      const out = { i, relation: live ? rec.relation : null, chip: "", notesLine: (first && first.key && first.info.input) ? "notes " + words(seg[0]) : "", rule: null, verdict: "",
                    nSegments: seg.length, more: [], bar, bars, shares: rec.shares.slice(), silent };
      if (!live) return out;
      const ri = rec.rep, r = raw[ri], rd = core.readings[ri], mode = r.key.mode;
      const rule = { kind: rd.kind, sentences: sentences(rd, r.key, C.parseInput(r.info.input)), where: null, codes: rd.codes.slice(), segment: ri };
      if (ri !== seg[0]) { const at = placeOf(score, r.start); rule.where = { bar: at.bar, beat: at.beat, notes: words(ri), text: "bar " + at.bar + ", beat " + at.beat }; }
      if (rd.kind === "chord") {
        const fam = familyOf(rd.label, mode), f = byId[fam] || lang.unknown || null, seventh = C.isSeventh(rd.label);
        rule.text = numeral(rd.label, mode); rule.family = fam; rule.familyName = nameOfFamily(f); rule.seventh = seventh;
        rule.hex = f ? ((seventh && assign.seventhShade !== false && f.seventh) ? f.seventh : f.triad) : null;
        // a diminished chord that is not the leading-tone chord, not on the second degree and not read as an applied chord takes
        // its color from one entry of the table (dimOther), whatever its reason says: say so after the reason
        const root = pair(rd.root), lead = mode === "major" ? [7, 0] : [7, 1], on = x => root[0] === x[0] && root[1] === x[1];
        if (rd.type === "tertian" && DIM.includes(rd.quality) && !fieldsOf(rd.label).chain && !on(lead) && !on([2, 0]) && !on([2, -1]) && fam === assign.dimOther)
          rule.sentences.splice(Math.min(2, rule.sentences.length), 0, DIM_COLOR_LINE);
      }
      out.rule = rule; out.chip = CHIPS[rec.relation];
      if (rec.relation === "same-name") {                                                   // root, kind and inversion agree; the numerals can still print differently
        const mine = numeral(s.label, s.key.mode);
        if (mine !== rule.text) out.verdict = "The root, the kind of chord and the inversion are the same. The names differ: " + mine + " from examples, " + rule.text + " by rule.";
      } else if (rec.relation === "same-color") {
        const mine = numeral(s.label, s.key.mode);
        out.verdict = mine === rule.text ? "The color is the same. The two names print alike; they differ in a detail the numeral does not show."
                                         : "The color is the same. The names differ: " + mine + " from examples, " + rule.text + " by rule.";
      } else if (rec.relation === "differ") out.verdict = "The score keeps the first color. Listen for which one you hear.";
      else if (rec.relation === "examples-only") out.verdict = "By rule there is no chord here. The score shows the reading from examples.";
      else if (rec.relation === "rule-only") out.verdict = "The notes stay grey on the score. The page colors only what the examples support.";
      else if (rec.relation === "neither") out.verdict = "The page has nothing to say about this chord. That is a limit of the page, not of the music.";
      if (!s.label && seg.length > 1) {                                                     // a stretch without a first reading can hold different notes
        for (const k of seg.slice(0, 3)) {
          const at = placeOf(score, raw[k].start), x = core.readings[k];
          out.more.push("bar " + at.bar + ", beat " + at.beat + " · " + notesWords(raw[k].key, C.parseInput(raw[k].info.input), false) + " · by rule " + (x && x.kind === "chord" ? numeral(x.label, raw[k].key.mode) : "no chord"));
        }
        if (seg.length > 3) out.more.push("and " + (seg.length - 3) + " more");
      }
      return out;
    });
  }
  // counts over the chords of the page and the phrase for the facts line
  function summary(readings) {
    const live = (readings || []).filter(r => !r.silent), n = live.length;
    const same = live.filter(r => r.relation === "same-name" || r.relation === "same-color").length, differ = live.filter(r => r.relation === "differ").length, other = n - same - differ;
    const seen = new Set(), barsAt = [];                                                    // every bar a card names, once; the chords whose card names a bar no earlier card named
    for (const r of live) {
      let fresh = false;
      for (const b of (r.bars && r.bars.length ? r.bars : r.bar ? [r.bar] : [])) if (!seen.has(b.index)) { seen.add(b.index); fresh = true; }
      if (fresh) barsAt.push(r.i);
    }
    const chords = !n ? "" : (differ === 0 && other === 0) ? "by rule: same color on all " + n
      : "by rule: same color on " + same + (differ ? ", different on " + differ : "") + (other ? ", no comparison for " + other : "");
    const bars = seen.size, barsText = bars ? bars + (bars === 1 ? " bar fits" : " bars fit") + " one symmetrical scale" : "";
    return { n, same, differ, other, bars, text: [chords, barsText].filter(Boolean).join("; "), phrases: [chords, barsText].filter(Boolean),
             differAt: live.filter(r => r.relation === "differ").map(r => r.i), barsAt };
  }
  // true when the chord-to-color table is the published one (the Reference's figures were measured with it)
  function isPublishedTable(language) {
    const a = language && language.assign, d = CK().DEFAULT_ASSIGN;
    if (!a) return true;
    const flat = x => JSON.stringify(Object.keys(x).sort().map(k => [k, (x[k] && typeof x[k] === "object") ? Object.keys(x[k]).sort().map(j => [j, x[k][j]]) : x[k]]));
    return flat(a) === flat(d);
  }

  global.CKSecond = { VERSION, WORDING, read, summary, isPublishedTable, attach, readSegments, segmentNotes, spanRelation, spanLine, barWeights, barReadings, barsOfSpan,
                      ruleReading, ticksFromDurations, serialize, relation, collectionOfBar, collectionShown, sentences, numeral, noteName, notesWords, placeOf, barWords,
                      RELATIONS, CHIPS, SHARED_LINE, DIM_COLOR_LINE };
})(typeof window !== "undefined" ? window : globalThis);
