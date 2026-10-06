/* Color Key: where a chord leads. A third layer beside the two readings: the name of a chord says where it leans (a dominant
   to the tonic, a chord before the dominant to the dominant, an applied chord to its target), and the next chord says
   whether the music goes there. Port of src/colorkey/lean.py (protocol p10-lean-v1, rules L1-L8 in that file's docstring);
   web/test_lean.html checks that both give the same output on every corpus movement. Strings and whole numbers only;
   nothing is counted or fitted here.

   Loads after colorkey.js and uses window.ColorKey (familyOf, labelParts, prettyAccidentals); nothing of any page. When
   second.js is on the page too, read() can say how the direction stands to each of two differing readings.

     CKLean.read(score, result, language, options)   one record per result.spans[i], the approaches, and the facts phrase
     CKLean.itemsOf(result)                          the sequence the rules read: one item per chord of the page
     CKLean.readItems(items), whatIf(items, i, label), lines(items), StepCounts    the core, identical to Python

   An item is { label, key, mode, skip }: key is any string that is equal for two chords in one key; skip is true for
   silence and for a chord joined to the one before it. A chord without a label is "unread".

   VERSION is the rule set the registered run measured (p10-20261005a) and does not move with the wording. WORDING counts
   revisions of the English sentences and of the page records only. */
(function (global) {
  "use strict";
  const VERSION = "1.0.0", WORDING = 1, MIN_STEPS = 20;
  const AUG6 = ["It6", "Ger6", "Fr6"], PREDOMINANT = ["subdominant", "supertonic", "neapolitan"];
  const CK = () => global.ColorKey;
  function fieldsOf(label) { const f = {}; for (const part of label.split(";")) { const i = part.indexOf("="); f[part.slice(0, i)] = part.slice(i + 1); } return f; }
  const isApplied = f => { const c = f.chain || ""; return !(c === "" || c === "?" || c === "1+0"); };
  const family = (label, mode) => CK().familyOf(label, mode);          // the published table, never a visitor's edited one

  // ------------------------------------------------------------------ L1 to L3: one label
  // [class, target]: class dominant | predominant | applied | aug6 | tonic | other; target "T" | "D" | "R:<degree>" | null
  function leanOf(label, mode) {
    if (!label) return ["other", null];
    const f = fieldsOf(label), q = f.q || "", tags = f.tags || "", applied = isApplied(f);
    if (AUG6.includes(q) || tags.startsWith("aug6")) return applied ? ["other", null] : ["aug6", "D"];             // a
    if (applied) {
      if (["5", "7"].includes((f.deg || "").slice(0, 1))) {                                                          // b
        const chain = (f.chain || "").split("/").filter(Boolean);
        if (chain.length !== 1) return ["other", null];
        return ["applied", chain[0] === "5+0" ? "D" : "R:" + chain[0]];
      }
      return ["other", null];                                                                                       // c
    }
    if (tags.includes("cad64")) return ["dominant", "T"];                                                           // d
    const fam = family(label, mode);
    if (fam === "dominant") return ["dominant", "T"];                                                               // e
    if (PREDOMINANT.includes(fam)) return ["predominant", "D"];                                                     // f
    if (fam === "tonic") return ["tonic", null];                                                                    // g
    return ["other", null];                                                                                         // h
  }
  function stageOf(label, mode) {
    const l = leanOf(label, mode), target = l[1];
    if (target === "T") return "D";
    if (target === "D") return "P";
    if (target) return "A:" + target.slice(2);
    if (l[0] === "tonic") return "T";
    const root = fieldsOf(label).root;
    return "O:" + (root === undefined ? "?" : root);
  }
  function isTarget(target, label, mode) {
    if (target === "T") return stageOf(label, mode) === "T";
    if (target === "D") return stageOf(label, mode) === "D";
    return fieldsOf(label).root === target.slice(2);
  }

  // ------------------------------------------------------------------ L4 to L6: a sequence
  const kindOf = it => it.skip ? "skip" : (it.label && it.key !== null && it.key !== undefined) ? "chord" : "unread";
  function judge(target, label, mode) {
    if (isTarget(target, label, mode)) return ["arrives", ""];
    return ["turns", (target === "T" && family(label, mode) === "submediant") ? "deceptive" : ""];
  }
  // { chords: one record per item (null for a skip or an unread item), runs, approaches }
  function readItems(items) {
    const runs = []; let cur = null;
    items.forEach((it, i) => {
      const kind = kindOf(it);
      if (kind === "skip") return;
      if (kind === "unread") { cur = null; return; }
      const st = stageOf(it.label, it.mode);
      if (cur !== null && cur.key === it.key && cur.stage === st) cur.items.push(i);
      else { const l = leanOf(it.label, it.mode); cur = { items: [i], key: it.key, stage: st, cls: l[0], target: l[1], outcome: null, detail: "", next: null, approach: null, pos: null }; runs.push(cur); }
    });
    for (const r of runs) {                                                                 // L5
      if (r.target === null) { r.outcome = r.cls === "tonic" ? "rest" : "none"; continue; }
      let j = r.items[r.items.length - 1] + 1;
      while (j < items.length && kindOf(items[j]) === "skip") j += 1;
      if (j >= items.length) { r.outcome = "open"; r.detail = "end"; }
      else if (kindOf(items[j]) === "unread") { r.outcome = "open"; r.detail = "unread"; }
      else if (items[j].key !== r.key) { r.outcome = "open"; r.detail = "key"; }
      else { const o = judge(r.target, items[j].label, items[j].mode); r.outcome = o[0]; r.detail = o[1]; r.next = j; }
    }
    const approaches = [];                                                                  // L6
    for (let k = 0; k < runs.length;) {
      if (runs[k].outcome !== "arrives") { k += 1; continue; }
      const chain = [k];
      while (runs[chain[chain.length - 1]].outcome === "arrives") chain.push(chain[chain.length - 1] + 1);
      const last = runs[chain[chain.length - 1]];
      chain.forEach((rk, pos) => { runs[rk].approach = approaches.length; runs[rk].pos = pos; });
      approaches.push({ runs: chain, first: runs[chain[0]].items[0], arrival: last.items[0], stages: chain.length, kind: last.stage === "T" ? "tonic" : last.stage === "D" ? "dominant" : "other" });
      k = chain[chain.length - 1] + 1;
    }
    const chords = new Array(items.length).fill(null);
    runs.forEach((r, rk) => { for (const i of r.items) chords[i] = { cls: leanOf(items[i].label, items[i].mode)[0], target: r.target, stage: r.stage, run: rk, outcome: r.outcome, detail: r.detail, next: r.next, approach: r.approach, pos: r.pos }; });
    return { chords, runs, approaches };
  }

  // ------------------------------------------------------------------ L7: what if chord i were read as another label
  // { forward, backward, next, prev }: next and prev are the items the two answers were judged against (null when there is none)
  function scan(items, i, label) {
    const key = items[i].key, mode = items[i].mode, l = leanOf(label, mode), target = l[1], st = stageOf(label, mode);
    const same = j => kindOf(items[j]) === "chord" && items[j].key === key && stageOf(items[j].label, items[j].mode) === st;
    let forward, next = null;
    if (target === null) forward = l[0] === "tonic" ? "rest" : "none";
    else {
      let j = i + 1;
      while (j < items.length && (kindOf(items[j]) === "skip" || same(j))) j += 1;
      if (j >= items.length) forward = "open:end";
      else if (kindOf(items[j]) === "unread") forward = "open:unread";
      else if (items[j].key !== key) forward = "open:key";
      else { const o = judge(target, items[j].label, items[j].mode); forward = o[0] + (o[1] ? ":" + o[1] : ""); next = j; }
    }
    let first = label, j = i - 1, backward, prev = null;
    while (j >= 0 && (kindOf(items[j]) === "skip" || same(j))) { if (kindOf(items[j]) === "chord") first = items[j].label; j -= 1; }
    if (j < 0 || kindOf(items[j]) === "unread" || items[j].key !== key) backward = "none";
    else { const t = leanOf(items[j].label, items[j].mode)[1]; prev = j; backward = t === null ? "no-lean" : isTarget(t, first, mode) ? "led" : "not-led"; }
    return { forward, backward, next, prev };
  }
  function whatIf(items, i, label) { const s = scan(items, i, label); return [s.forward, s.backward]; }

  // one line per item: the form the Python / JavaScript equality check compares
  function line(rec, approaches) {
    if (rec === null || rec === undefined) return "-";
    const a = rec.approach !== null ? approaches[rec.approach] : null;
    return [rec.cls, rec.target || "-", rec.stage, rec.outcome, rec.detail || "-", rec.next === null ? "-" : String(rec.next),
            a === null ? "-" : rec.approach + ":" + rec.pos + ":" + a.stages + ":" + a.kind + ":" + a.first + ":" + a.arrival].join("|");
  }
  function lines(items) { const out = readItems(items); return out.chords.map(rec => line(rec, out.approaches)); }

  // ------------------------------------------------------------------ L8: step counts, for the wording only
  // bi: the counted steps a -> y, as a Map of Maps (ColorKey.ProgressionModel.bi) or a plain object of objects
  class StepCounts {
    constructor(bi) {
      this.rows = new Map();
      if (bi instanceof Map) for (const [a, row] of bi) this.rows.set(a, row instanceof Map ? [...row] : Object.entries(row));
      else for (const a of Object.keys(bi || {})) this.rows.set(a, Object.entries(bi[a]));
      this.stages = new Map(); this.byLabel = new Map(); this.pool = new Map();
    }
    stage(label, mode) { const k = mode + "\u0001" + label; let v = this.stages.get(k); if (v === undefined) { v = stageOf(label, mode); this.stages.set(k, v); } return v; }
    count(a, st, target, mode) {
      let k = 0, n = 0;
      for (const [y, c] of (this.rows.get(a) || [])) { if (this.stage(y, mode) === st) continue; n += c; if (isTarget(target, y, mode)) k += c; }
      return [k, n];
    }
    // { k, n, K, N, level } for a label with a target, null for one without
    of(label, mode) {
      const key = mode + "\u0001" + label;
      if (this.byLabel.has(key)) return this.byLabel.get(key);
      const target = leanOf(label, mode)[1];
      if (target === null) { this.byLabel.set(key, null); return null; }
      const st = this.stage(label, mode), own = this.count(label, st, target, mode), pk = mode + "\u0001" + st;
      if (!this.pool.has(pk)) {
        let K = 0, N = 0;
        for (const a of this.rows.keys()) if (this.stage(a, mode) === st) { const x = this.count(a, st, target, mode); K += x[0]; N += x[1]; }
        this.pool.set(pk, [K, N]);
      }
      const p = this.pool.get(pk), out = { k: own[0], n: own[1], K: p[0], N: p[1], level: own[1] >= MIN_STEPS ? "label" : "stage" };
      this.byLabel.set(key, out); return out;
    }
  }
  const countsLine = c => (c === null || c === undefined) ? "-" : c.k + "/" + c.n + "|" + c.K + "/" + c.N + "|" + c.level;

  // ------------------------------------------------------------------ the page: one record per chord, in English (JavaScript only)
  // a chord the visitor changed is not read: the direction belongs to a name, and that name is no longer the page's
  const changed = s => !!(s.familyOverride || s.textOverride || s.taught || s.corrected || s.studio);
  function itemsOf(result) {
    return result.spans.map(s => ({ label: changed(s) ? null : (s.label || null), key: s.key ? s.key.tonicPc + "|" + s.key.mode : null, mode: s.key ? s.key.mode : null,
                                    skip: s.status === "silent" || !!s.continuation }));
  }
  function numeral(label, mode) {       // as the score prints it
    const p = CK().labelParts(label, mode); if (!p) return "?";
    return CK().prettyAccidentals((p.special || (p.acc + p.numeral + (p.quality || "").replace("o", "°"))) + p.figures.join("") + p.adds + p.target);
  }
  const count = n => Number(n).toLocaleString("en-US");
  function measureAt(score, t) { let lo = 0, hi = score.measures.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (score.measures[mid].start.le(t)) lo = mid + 1; else hi = mid; } return Math.max(0, lo - 1); }
  function barOf(score, t) { const m = score && score.measures && score.measures.length ? score.measures[measureAt(score, t)] : null; return m ? (m.printedNumber || String(m.index)) : "?"; }
  // the degree an applied chord is aimed at, as its own numeral prints it ("ii", "IV", "♭II"); "V" for the dominant
  function aimOf(label, mode) { const p = CK().labelParts(label, mode); return p && p.target ? CK().prettyAccidentals(p.target.slice(1)) : "V"; }
  const FOLLOWED = { T: "a tonic chord", D: "a chord of the dominant" };
  function leadWords(rec, label, mode) {         // the first half of the sentence: what this chord leans to
    if (rec.cls === "dominant") return "Leans to the tonic";
    if (rec.cls === "predominant") return "Prepares the dominant";
    if (rec.cls === "aug6") return "An augmented sixth: it leans to the dominant";
    const kind = (fieldsOf(label).deg || "").charAt(0) === "7" ? "A leading-tone chord of " : "A dominant of ", aim = aimOf(label, mode);
    return kind + aim + ": it leans to " + (rec.target === "D" ? "the dominant" : aim);
  }
  // a row of chord names for an approach: every chord in order, a name that repeats said once, a long row shortened in the middle
  function chainWords(names) {
    const out = []; for (const n of names) if (!out.length || out[out.length - 1] !== n) out.push(n);
    return (out.length > 7 ? out.slice(0, 2).concat(["…"], out.slice(-4)) : out).join(" → ");
  }
  // The four sentences about two differing readings. x: the name of the chord the lean was judged against; near: it stands right beside this
  // chord (nothing but silence between). Otherwise chords that lean the same way as the reading were looked through, and the sentence says so.
  const NEXT = (x, near) => (near ? "The next chord, " : "The next chord of another kind, ") + x, BEFORE = (x, near) => (near ? "The chord before, " : "The last chord of another kind before it, ") + x;
  const HINTS = { forward_second: (x, near) => NEXT(x, near) + ", is where the second reading leans.", forward_first: (x, near) => NEXT(x, near) + ", is where the first reading leans.",
                  backward_second: (x, near) => BEFORE(x, near) + ", leans to the second reading.", backward_first: (x, near) => BEFORE(x, near) + ", leans to the first reading." };
  // the label of the rule reading the card shows for a chord (second.js), or null
  function ruleLabel(score, result, rd) {
    const S = global.CKSecond;
    if (!S || !rd || rd.relation !== "differ" || !rd.rule || rd.rule.kind !== "chord") return null;
    try { const r = result.raw[rd.rule.segment], n = S.segmentNotes(score, r.start, r.end, r.key, r.info), x = S.ruleReading(n.mode, n.notes, n.bass); return x.kind === "chord" ? x.label : null; }
    catch (e) { return null; }
  }
  const cellOf = (a, b) => (a && b) ? "both" : b ? "second" : a ? "first" : "neither";

  // One record per result.spans[i]; changes nothing in score, result or language.
  //   options.counts  a StepCounts, or the step table itself (ColorKey.ProgressionModel.bi): the sentence for the fold
  //   options.second  the records of CKSecond.read for the same result: where two readings differ, how the direction stands to each
  //   options.hints   { forward_second, forward_first, backward_second, backward_first }: which sentences the registered run allows
  // Returns { records, approaches, summary }.
  //   record    null for silence and for a chord joined to the one before; otherwise { i, live, cls, target, outcome, detail, next, from,
  //             approach, sentences, more, evidence, hint }. live is false for a chord without a reading of the page's own.
  //   approach  { id, stages, kind, chords (span indexes in order), first, arrival, drawn (three or more stages), text (the names up to the arrival) }
  function read(score, result, language, options) {
    const opt = options || {}, spans = result.spans, items = itemsOf(result), core = readItems(items);
    const counts = !opt.counts ? null : (opt.counts instanceof StepCounts ? opt.counts : new StepCounts(opt.counts));
    const name = i => numeral(items[i].label, items[i].mode);
    const entered = core.runs.map((r, k) => { const p = k ? core.runs[k - 1] : null; return (p && p.next !== null && p.next === r.items[0]) ? { run: k - 1, how: p.outcome + (p.detail ? ":" + p.detail : "") } : null; });
    const approaches = core.approaches.map((a, id) => {
      const chords = []; for (const rk of a.runs) for (const i of core.runs[rk].items) chords.push(i);
      return { id, stages: a.stages, kind: a.kind, chords, first: a.first, arrival: a.arrival, drawn: a.stages >= 3, text: chainWords(chords.slice(0, chords.indexOf(a.arrival) + 1).map(name)) };
    });
    const records = spans.map((s, i) => {
      if (items[i].skip) return null;
      const rec = core.chords[i];
      if (rec === null) return { i, live: false, cls: null, target: null, outcome: null, detail: "", next: null, from: null, approach: null, sentences: [], more: "", evidence: null, hint: "" };
      const run = core.runs[rec.run], label = items[i].label, mode = items[i].mode, ent = entered[rec.run], last = run.items[run.items.length - 1];
      const from = ent ? core.runs[ent.run].items[core.runs[ent.run].items.length - 1] : null;       // the chord right before this stage, when it leads or turns here
      const out = { i, live: true, cls: rec.cls, target: rec.target, outcome: rec.outcome, detail: rec.detail, next: rec.next, from, approach: rec.approach === null ? null : approaches[rec.approach],
                    sentences: [], more: "", evidence: null, hint: "" };
      const came = !ent ? "" : ent.how === "arrives" ? " " + name(from) + " arrives here." : ent.how === "turns:deceptive" ? " " + name(from) + " turns here instead of going to the tonic." : "";
      let first;
      if (rec.target === null) first = (rec.cls === "tonic" ? (came ? "At rest: the tonic." : "At rest: the tonic leans nowhere.") : "The page gives this chord no direction of its own.") + came;
      else {
        const lead = leadWords(rec, label, mode), via = last !== i ? "after " + name(last) + " " : "";
        if (rec.outcome === "arrives") first = lead + ", and " + via + "the next chord is " + name(rec.next) + ": it arrives.";
        else if (rec.outcome === "turns") first = lead + ", but " + via + name(rec.next) + " follows instead" + (rec.detail === "deceptive" ? ": the deceptive turn." : ".");
        else if (rec.detail === "key") first = lead + ", but the key changes first. The page does not follow a lean across a change of key.";
        else if (rec.detail === "end") first = lead + ", but the piece ends first.";
        else { let j = last + 1; while (j < spans.length && items[j].skip) j += 1;
          first = lead + (j < spans.length && changed(spans[j]) ? ". The next chord is one you changed, so the page does not follow it." : ", but the page has no reading of the chord that follows."); }
      }
      out.sentences.push(first);
      const a = out.approach;
      if (a && a.drawn) out.sentences.push(a.arrival === i ? "An approach arrives here: " + a.text + "."
        : core.chords[a.arrival].run === rec.run ? "An approach arrived here in bar " + barOf(score, spans[a.arrival].start) + ": " + a.text + "."
        : "Part of an approach: " + a.text + ", arriving in bar " + barOf(score, spans[a.arrival].start) + ".");
      if (counts && rec.target !== null) {
        const c = counts.of(label, mode), to = FOLLOWED[rec.target] || "a chord on " + aimOf(label, mode);
        if (c && c.level === "label") out.more = "In the expert analyses, when " + name(i) + " gave way to a chord of another kind, that chord was " + to + " " + count(c.k) + " times out of " + count(c.n) + ".";
        else if (c && c.N > 0) out.more = "In the expert analyses, when a chord that leans the same way as " + name(i) + " gave way to a chord of another kind, that chord was " + to + " " + count(c.K) + " times out of " + count(c.N) +
          ". For " + name(i) + " alone there are too few to count (" + count(c.n) + ").";
        out.counts = c;
      }
      const l2 = opt.second ? ruleLabel(score, result, opt.second[i]) : null;
      if (l2) {
        const a1 = scan(items, i, label), a2 = scan(items, i, l2);
        const ev = { forward: cellOf(a1.forward === "arrives", a2.forward === "arrives"), backward: cellOf(a1.backward === "led", a2.backward === "led"), first: [a1.forward, a1.backward], second: [a2.forward, a2.backward] };
        out.evidence = ev;
        const H = opt.hints || {}, said = [];
        const near = (j, step) => { let k = i + step; while (k >= 0 && k < items.length && items[k].skip) k += step; return k === j; };
        if (ev.forward === "second" && H.forward_second) said.push(HINTS.forward_second(name(a2.next), near(a2.next, 1)));
        if (ev.forward === "first" && H.forward_first) said.push(HINTS.forward_first(name(a1.next), near(a1.next, 1)));
        if (ev.backward === "second" && H.backward_second) said.push(HINTS.backward_second(name(a2.prev), near(a2.prev, -1)));
        if (ev.backward === "first" && H.backward_first) said.push(HINTS.backward_first(name(a1.prev), near(a1.prev, -1)));
        out.hint = said.join(" ");
      }
      return out;
    });
    return { records, approaches, summary: summary(approaches) };
  }
  // the phrase for the facts line; "at" lists the arrival chords of the approaches the score draws, in score order
  function summary(approaches) {
    const drawn = (approaches || []).filter(a => a.drawn), tonic = drawn.filter(a => a.kind === "tonic").length, n = drawn.length;
    const text = !n ? "" : tonic === n ? n + (n === 1 ? " approach" : " approaches") + " to the tonic" : n + (n === 1 ? " approach" : " approaches") + ", " + (tonic || "none") + " to the tonic";
    return { approaches: n, tonic, text, at: drawn.map(a => a.arrival) };
  }

  global.CKLean = { VERSION, WORDING, MIN_STEPS, read, summary, itemsOf, readItems, whatIf, scan, line, lines, leanOf, stageOf, isTarget, StepCounts, countsLine, numeral, chainWords, HINTS };
})(typeof window !== "undefined" ? window : globalThis);
