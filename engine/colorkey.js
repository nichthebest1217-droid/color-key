/* Color Key — browser engine 2.0.0. A JavaScript port of the Python pipeline (src/colorkey): MusicXML reader (score adapter
   semantics of io_musicxml.py), sequential key tracker (keyfinder.py, optional key-signature start prior D029), gated beat
   segmenter (segmenters.py), dictionary lookup with back-off (dictionary.py / backoff.py), span merging (analyzer.py),
   the Color Key language v0.2 (language.py) and colouring. Exact rational time.
   Verified against the Python outputs on corpus movements (see web/test.html and LOG.md). No dependencies. */
(function (global) {
  "use strict";
  // ------------------------------------------------------------------ exact rationals
  function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; }
  class Frac {
    constructor(n, d) { if (d === undefined) d = 1; if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); this.n = n / g; this.d = d / g; }
    static of(x) { return x instanceof Frac ? x : new Frac(x, 1); }
    add(o) { o = Frac.of(o); return new Frac(this.n * o.d + o.n * this.d, this.d * o.d); }
    sub(o) { o = Frac.of(o); return new Frac(this.n * o.d - o.n * this.d, this.d * o.d); }
    mul(o) { o = Frac.of(o); return new Frac(this.n * o.n, this.d * o.d); }
    cmp(o) { o = Frac.of(o); const a = this.n * o.d, b = o.n * this.d; return a < b ? -1 : a > b ? 1 : 0; }
    lt(o) { return this.cmp(o) < 0; } le(o) { return this.cmp(o) <= 0; } gt(o) { return this.cmp(o) > 0; } ge(o) { return this.cmp(o) >= 0; } eq(o) { return this.cmp(o) === 0; }
    num() { return this.n / this.d; } str() { return this.n + "/" + this.d; }
    static max(a, b) { return a.ge(b) ? a : b; } static min(a, b) { return a.le(b) ? a : b; }
    static parse(s) { const p = s.split("/"); return new Frac(parseInt(p[0], 10), p.length > 1 ? parseInt(p[1], 10) : 1); }
  }
  const F0 = new Frac(0, 1);
  const STEP_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
  const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const STEPS = "CDEFGAB";
  const ACC = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "##" };
  function mod(a, n) { return ((a % n) + n) % n; }
  function pitchName(p) { return p.step + (ACC[String(p.alter)] !== undefined ? ACC[String(p.alter)] : (p.alter > 0 ? "#".repeat(p.alter) : "b".repeat(-p.alter))) + p.octave; }
  function makePitch(step, alter, octave) { const midi = 12 * (octave + 1) + STEP_PC[step] + alter; return { step, alter, octave, midi, pc: mod(midi, 12), name: pitchName({ step, alter, octave }) }; }

  // ------------------------------------------------------------------ MusicXML reader (score-partwise)
  function childText(el, name) { for (const c of el.children) if (c.localName === name) return c.textContent; return null; }
  function child(el, name) { for (const c of el.children) if (c.localName === name) return c; return null; }
  function children(el, name) { const out = []; for (const c of el.children) if (c.localName === name) out.push(c); return out; }

  function readScore(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    const perr = doc.getElementsByTagName("parsererror");
    if (perr.length) throw new Error("The file is not well-formed XML: " + perr[0].textContent.slice(0, 200));
    const root = doc.documentElement;
    if (root.localName !== "score-partwise") throw new Error("Only score-partwise MusicXML is supported (got <" + root.localName + ">). Timewise files can be converted in MuseScore.");
    const diagnostics = [];
    const partNames = {};
    for (const sp of root.getElementsByTagName("score-part")) partNames[sp.getAttribute("id")] = childText(sp, "part-name") || "";
    const parts = children(root, "part");
    if (!parts.length) throw new Error("No <part> elements found.");
    // pass 1: per part, per measure: content length, time signature, divisions, raw note/direction events
    const partData = [];
    for (const p of parts) {
      const pid = p.getAttribute("id");
      let divisions = null, staves = 1, transpose = null;
      const measures = [];
      for (const mx of children(p, "measure")) {
        let pos = F0, maxpos = F0, lastNoteOnset = F0, ts = null, keySig = null;
        const notes = [], ottavas = [];
        const voicesSeen = {};   // staff -> Set of voice numbers
        for (const el of mx.children) {
          const tag = el.localName;
          if (tag === "attributes") {
            const d = childText(el, "divisions"); if (d) divisions = parseInt(d, 10);
            const st = childText(el, "staves"); if (st) staves = parseInt(st, 10);
            const t = child(el, "time");
            if (t && childText(t, "beats")) ts = { beats: childText(t, "beats"), beatType: childText(t, "beat-type") };
            const ke = child(el, "key"); if (ke && childText(ke, "fifths") !== null) keySig = parseInt(childText(ke, "fifths"), 10);
            const tr = child(el, "transpose");
            if (tr) transpose = { chromatic: parseInt(childText(tr, "chromatic") || "0", 10), diatonic: parseInt(childText(tr, "diatonic") || "0", 10), octaveChange: parseInt(childText(tr, "octave-change") || "0", 10) };
          } else if (tag === "note") {
            const isGrace = !!child(el, "grace"), isChord = !!child(el, "chord"), isRest = !!child(el, "rest"), isCue = !!child(el, "cue");
            const durText = childText(el, "duration");
            const dur = (durText && divisions) ? new Frac(parseInt(durText, 10), divisions) : F0;
            const onset = isChord ? lastNoteOnset : pos;
            const pe = child(el, "pitch");
            let pitch = null;
            if (pe) {
              const alterText = childText(pe, "alter");
              const alterF = alterText ? parseFloat(alterText) : 0;
              if (alterF !== Math.round(alterF)) diagnostics.push({ kind: "microtonal_alter", part: pid, measure: measures.length + 1 });
              pitch = { step: childText(pe, "step"), alter: Math.round(alterF), octave: parseInt(childText(pe, "octave"), 10) };
            } else if (child(el, "unpitched")) {
              diagnostics.push({ kind: "unpitched_note_skipped", part: pid, measure: measures.length + 1 });
            }
            const voice = childText(el, "voice");
            const staff = parseInt(childText(el, "staff") || "1", 10);
            const ties = children(el, "tie").map(t => t.getAttribute("type"));
            const tie = ties.includes("start") && ties.includes("stop") ? "continue" : ties.includes("start") ? "start" : ties.includes("stop") ? "stop" : null;
            if (!voicesSeen[staff]) voicesSeen[staff] = new Set();
            if (voice) voicesSeen[staff].add(voice);
            notes.push({ el, isGrace, isChord, isRest, isCue, dur: isGrace ? F0 : dur, offset: onset, pitch, voice, staff, tie });
            if (!isChord && !isGrace) { lastNoteOnset = pos; pos = pos.add(dur); if (pos.gt(maxpos)) maxpos = pos; }
            else if (!isChord) { lastNoteOnset = pos; }
          } else if (tag === "backup") {
            const d = childText(el, "duration"); if (d && divisions) pos = pos.sub(new Frac(parseInt(d, 10), divisions));
          } else if (tag === "forward") {
            const d = childText(el, "duration"); if (d && divisions) { pos = pos.add(new Frac(parseInt(d, 10), divisions)); if (pos.gt(maxpos)) maxpos = pos; }
          } else if (tag === "direction") {
            for (const dt of children(el, "direction-type")) {
              const os = child(dt, "octave-shift");
              if (os) {
                let t = pos; const off = childText(el, "offset");
                if (off && divisions) t = t.add(new Frac(parseInt(off, 10), divisions));
                ottavas.push({ type: os.getAttribute("type"), size: parseInt(os.getAttribute("size") || "8", 10), staff: parseInt(childText(el, "staff") || "1", 10), t });
              }
            }
          }
        }
        measures.push({ el: mx, number: mx.getAttribute("number"), implicit: mx.getAttribute("implicit") === "yes", contentLength: maxpos, ts, keySig, divisions, notes, ottavas, voicesSeen });
      }
      partData.push({ pid, name: partNames[pid] || "", measures, staves, transpose });
    }
    // reference part: meters per measure index
    const ref = partData[0];
    const nMeas = Math.max(...partData.map(p => p.measures.length));
    for (const p of partData) if (p.measures.length !== nMeas) diagnostics.push({ kind: "measure_count_mismatch", part: p.pid, count: p.measures.length, reference: nMeas });
    const tsByIndex = {};
    ref.measures.forEach((m, i) => { if (m.ts) tsByIndex[i + 1] = m.ts; });
    if (!tsByIndex[1]) { diagnostics.push({ kind: "no_initial_meter" }); tsByIndex[1] = { beats: "4", beatType: "4" }; }
    function meterQuarters(ts) { const num = ts.beats.split("+").map(x => parseInt(x, 10)).reduce((a, b) => a + b, 0); return new Frac(num * 4, parseInt(ts.beatType, 10)); }
    // consensus measure grid
    const consensus = [], gridStart = [];
    let cur = tsByIndex[1], t = F0;
    const deviating = new Set();
    for (let i = 0; i < nMeas; i++) {
      if (tsByIndex[i + 1]) cur = tsByIndex[i + 1];
      const nominal = meterQuarters(cur);
      const vals = partData.map(p => p.measures[i] ? p.measures[i].contentLength : null).filter(x => x !== null);
      let pos = vals.filter(v => v.gt(F0)); if (!pos.length) pos = vals;
      const counts = new Map();
      for (const v of pos) { const k = v.str(); counts.set(k, (counts.get(k) || 0) + 1); }
      const top = Math.max(...counts.values());
      const cands = [...counts.entries()].filter(([k, c]) => c === top).map(([k]) => Frac.parse(k)).sort((a, b) => a.cmp(b));
      let chosen;
      if (cands.length === 1) chosen = cands[0]; else if (cands.some(c => c.eq(nominal))) chosen = nominal; else chosen = cands[cands.length - 1];
      partData.forEach(p => { if (p.measures[i] && !p.measures[i].contentLength.eq(chosen)) { deviating.add(p.pid + "|" + (i + 1)); diagnostics.push({ kind: "part_measure_duration_deviates", part: p.pid, index: i + 1, part_duration: p.measures[i].contentLength.str(), consensus: chosen.str() }); } });
      consensus.push(chosen); gridStart.push(t); t = t.add(chosen);
    }
    const scoreEnd = t;
    const measures = [];
    cur = tsByIndex[1];
    for (let i = 1; i <= nMeas; i++) {
      if (tsByIndex[i]) cur = tsByIndex[i];
      const mq = meterQuarters(cur);
      const dur = consensus[i - 1];
      measures.push({ index: i, printedNumber: ref.measures[i - 1] ? ref.measures[i - 1].number : String(i), start: gridStart[i - 1], end: gridStart[i - 1].add(dur), meter: cur.beats + "/" + cur.beatType, meterQuarters: mq, isPickup: i === 1 && dur.lt(mq), divisions: ref.measures[i - 1] ? ref.measures[i - 1].divisions : null });
    }
    // notation records with sounding pitches
    const notation = [];
    let nOttava = 0, nTransposing = 0;
    for (const p of partData) {
      // ottava intervals per staff: from a start direction to the matching stop (document/time order)
      const intervals = [];
      const open = {};
      p.measures.forEach((m, i) => {
        for (const o of m.ottavas) {
          const tt = gridStart[i].add(o.t);
          if (o.type === "stop") { if (open[o.staff]) { intervals.push({ staff: o.staff, start: open[o.staff].start, end: tt, shift: open[o.staff].shift }); delete open[o.staff]; } }
          else {
            const semis = (o.type === "down" ? -1 : 1) * (o.size === 15 ? 24 : o.size === 22 ? 36 : 12);   // XML 'down' sounds an octave below the printed pitch (D020)
            open[o.staff] = { start: tt, shift: semis }; nOttava += 1;
          }
        }
      });
      for (const s in open) intervals.push({ staff: parseInt(s, 10), start: open[s].start, end: scoreEnd, shift: open[s].shift });
      if (p.transpose && (p.transpose.chromatic || p.transpose.octaveChange)) nTransposing += 1;
      p.measures.forEach((m, i) => {
        if (i >= nMeas) return;
        const mStart = gridStart[i], mEnd = mStart.add(consensus[i]);
        const ordinals = {};
        let chordIndex = 0;
        for (const n of m.notes) {
          const multiVoice = m.voicesSeen[n.staff] && m.voicesSeen[n.staff].size > 1;
          const voice = multiVoice ? n.voice : null;
          const partId = p.staves > 1 ? p.pid + "-Staff" + n.staff : p.pid;
          const ok = partId + "|v" + (voice || "-");
          if (!n.isChord) { ordinals[ok] = (ordinals[ok] || 0); chordIndex = 0; }
          const ordinal = ordinals[ok];
          const onset = mStart.add(n.offset);
          let dur = n.dur;
          const locator = partId + "|m" + (i + 1) + "|v" + (voice || "-") + "|o" + n.offset.str() + "|" + ordinal + (n.isChord ? "." + chordIndex : "");
          if (n.isRest) {
            const flags = [];
            if (onset.add(dur).gt(mEnd) && onset.lt(mEnd)) { dur = mEnd.sub(onset); flags.push("rest_clipped_to_measure"); }
            notation.push({ locator, partId, staff: n.staff, voice, measureIndex: i + 1, onset, duration: dur, written: null, sounding: null, isRest: true, isGrace: n.isGrace, isCue: false, tie: null, el: n.el, flags });
          } else if (n.pitch) {
            const pw = makePitch(n.pitch.step, n.pitch.alter, n.pitch.octave);
            let ps = pw;
            if (p.transpose && (p.transpose.chromatic || p.transpose.diatonic || p.transpose.octaveChange)) {
              const si = STEP_INDEX[pw.step] + p.transpose.diatonic; const step = STEPS[mod(si, 7)];
              const midi = pw.midi + p.transpose.chromatic + 12 * p.transpose.octaveChange;
              const octave = Math.floor((midi - STEP_PC[step]) / 12) - 1;   // octave that makes step+alter consistent (alter within ±2 for normal transpositions)
              let alter = midi - (12 * (octave + 1) + STEP_PC[step]);
              ps = makePitch(step, alter, octave);
            }
            const iv = intervals.find(v => v.staff === n.staff && v.start.le(onset) && onset.lt(v.end));
            if (iv) ps = makePitch(ps.step, ps.alter, ps.octave + iv.shift / 12);
            notation.push({ locator, partId, staff: n.staff, voice, measureIndex: i + 1, onset, duration: dur, written: pw, sounding: ps, isRest: false, isGrace: n.isGrace, isCue: n.isCue, tie: n.tie, el: n.el, flags: deviating.has(p.pid + "|" + (i + 1)) ? ["measure_duration_deviates"] : [] });
          }
          if (n.isChord) chordIndex += 1; else ordinals[ok] += 1;
          if (n.isChord && n.pitch) { /* chord heads share the ordinal of their first note */ }
        }
      });
    }
    const sounding = buildSounding(notation, diagnostics);
    const keySignatures = [];
    ref.measures.forEach((m, i) => { if (m.keySig !== null && i < nMeas) keySignatures.push({ index: i + 1, start: gridStart[i], sharps: m.keySig }); });
    return { doc, parts: partData.map(p => ({ id: p.pid, name: p.name, staves: p.staves })), measures, notation, sounding, scoreEnd, keySignatures, meters: Object.keys(tsByIndex).map(i => ({ index: parseInt(i, 10), ratio: tsByIndex[i].beats + "/" + tsByIndex[i].beatType })),
             diagnostics, policy: (nTransposing ? nTransposing + " transposing part(s) shifted to sounding pitch (untested against the corpus); " : "written pitch == sounding pitch; ") + nOttava + " octave-shift line(s) applied to sounding pitch" };
  }

  function buildSounding(notation, diagnostics) {
    const pitched = notation.filter(r => !r.isRest && !r.isGrace && r.sounding);
    const byKey = new Map();
    const keyOf = (r, onset) => r.partId + "|" + r.sounding.step + "|" + r.sounding.alter + "|" + r.sounding.octave + "|" + onset.str();
    for (const r of pitched) if (r.tie === "continue" || r.tie === "stop") { const k = keyOf(r, r.onset); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
    const consumed = new Set();
    const order = pitched.slice().sort((a, b) => a.onset.cmp(b.onset) || (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0) || (a.sounding.midi - b.sounding.midi) || (a.locator < b.locator ? -1 : a.locator > b.locator ? 1 : 0));
    const events = [];
    for (const r of order) {
      if (consumed.has(r.locator)) continue;
      if (r.tie === "continue" || r.tie === "stop") diagnostics.push({ kind: "orphan_tie_continuation", locator: r.locator });
      const chain = [r]; let cur = r, merged = false;
      while (cur.tie === "start" || cur.tie === "continue") {
        const k = keyOf(cur, cur.onset.add(cur.duration));
        let cands = (byKey.get(k) || []).filter(c => !consumed.has(c.locator) && c.locator !== cur.locator);
        if (cands.length > 1) { const sv = cands.filter(c => c.voice === cur.voice && c.staff === cur.staff); if (sv.length === 1) cands = sv; }
        if (cands.length === 1) { consumed.add(cands[0].locator); chain.push(cands[0]); cur = cands[0]; merged = true; }
        else if (!cands.length) { diagnostics.push({ kind: "unterminated_tie", locator: cur.locator }); break; }
        else { diagnostics.push({ kind: "ambiguous_tie", locator: cur.locator }); break; }
      }
      consumed.add(r.locator);
      const last = chain[chain.length - 1];
      events.push({ partId: r.partId, start: r.onset, end: last.onset.add(last.duration), pitch: r.sounding, records: chain, mergedFromTie: merged });
    }
    events.sort((a, b) => a.start.cmp(b.start) || (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0) || (a.pitch.midi - b.pitch.midi));
    events.forEach((e, i) => { e.id = "e" + i; });
    return events;
  }

  // ------------------------------------------------------------------ key tracking (Krumhansl–Kessler + Viterbi)
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  // D031: published key profiles, values as in music21 analysis.discrete (Aarden-Essen, Bellman-Budge, Temperley-Kostka-Payne)
  const AARDEN_MAJOR = [17.7661, 0.145624, 14.9265, 0.160186, 19.8049, 11.3587, 0.291248, 22.062, 0.145624, 8.15494, 0.232998, 4.95122];
  const AARDEN_MINOR = [18.2648, 0.737619, 14.0499, 16.8599, 0.702494, 14.4362, 0.702494, 18.6161, 4.56621, 1.93186, 7.37619, 1.75623];
  const BELLMAN_MAJOR = [16.8, 0.86, 12.95, 1.41, 13.49, 11.93, 1.25, 20.28, 1.8, 8.04, 0.62, 10.57];
  const BELLMAN_MINOR = [18.16, 0.69, 12.99, 13.34, 1.07, 11.15, 1.38, 21.07, 7.49, 1.53, 0.92, 10.21];
  const TEMPERLEY_MAJOR = [0.748, 0.060, 0.488, 0.082, 0.670, 0.460, 0.096, 0.715, 0.104, 0.366, 0.057, 0.400];
  const TEMPERLEY_MINOR = [0.712, 0.084, 0.474, 0.618, 0.049, 0.460, 0.105, 0.747, 0.404, 0.067, 0.133, 0.330];
  const PROFILES = { kk: { major: KK_MAJOR, minor: KK_MINOR }, aarden: { major: AARDEN_MAJOR, minor: AARDEN_MINOR },
                     bellman: { major: BELLMAN_MAJOR, minor: BELLMAN_MINOR }, temperley: { major: TEMPERLEY_MAJOR, minor: TEMPERLEY_MINOR } };
  const MAJOR_SPELLING = { 0: ["C", 0], 1: ["D", -1], 2: ["D", 0], 3: ["E", -1], 4: ["E", 0], 5: ["F", 0], 6: ["F", 1], 7: ["G", 0], 8: ["A", -1], 9: ["A", 0], 10: ["B", -1], 11: ["B", 0] };
  const MINOR_SPELLING = { 0: ["C", 0], 1: ["C", 1], 2: ["D", 0], 3: ["E", -1], 4: ["E", 0], 5: ["F", 0], 6: ["F", 1], 7: ["G", 0], 8: ["G", 1], 9: ["A", 0], 10: ["B", -1], 11: ["B", 0] };
  const KEY_NAMES = []; for (let pc = 0; pc < 12; pc++) { KEY_NAMES.push([pc, "major"]); KEY_NAMES.push([pc, "minor"]); }
  function keyFromIndex(k, source) { const [pc, mode] = KEY_NAMES[k]; const [step, alter] = (mode === "major" ? MAJOR_SPELLING : MINOR_SPELLING)[pc]; return { tonicStep: step, tonicAlter: alter, tonicPc: pc, mode, source: source || "estimated:kk_viterbi", name: step + ACC[String(alter)] + " " + mode, index: k }; }
  function zNorm(v) { const m = v.reduce((a, b) => a + b, 0) / v.length; const c = v.map(x => x - m); const n = Math.sqrt(c.reduce((a, x) => a + x * x, 0)); return n > 0 ? c.map(x => x / n) : null; }
  function templatesFrom(major, minor) { return KEY_NAMES.map(([pc, mode]) => { const t = mode === "major" ? major : minor; return zNorm(Array.from({ length: 12 }, (_, i) => t[mod(i - pc, 12)])); }); }
  function profileTemplates(name, learned) {
    if (name === "learned") { if (!learned) throw new Error("learned key profile not supplied"); return templatesFrom(learned.major, learned.minor); }
    const p = PROFILES[name]; if (!p) throw new Error("unknown key profile " + name);
    return templatesFrom(p.major, p.minor);
  }
  const TEMPLATES = templatesFrom(KK_MAJOR, KK_MINOR);

  class PCProfileIndex {
    constructor(events) {
      const set = new Map();
      for (const e of events) { set.set(e.start.str(), e.start); set.set(e.end.str(), e.end); }
      this.times = [...set.values()].sort((a, b) => a.cmp(b));
      const n = this.times.length;
      const idx = new Map(this.times.map((t, i) => [t.str(), i]));
      this.rate = Array.from({ length: Math.max(n - 1, 0) }, () => new Array(12).fill(0));
      for (const e of events) { const i = idx.get(e.start.str()), j = idx.get(e.end.str()); for (let k = i; k < j; k++) this.rate[k][e.pitch.pc] += 1; }
      this.cum = [new Array(12).fill(F0)];
      for (let k = 0; k < this.rate.length; k++) { const len = this.times[k + 1].sub(this.times[k]); const prev = this.cum[k]; this.cum.push(prev.map((c, pc) => c.add(len.mul(this.rate[k][pc])))); }
    }
    bisectRight(t) { let lo = 0, hi = this.times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (this.times[mid].le(t)) lo = mid + 1; else hi = mid; } return lo; }
    profile(a, b) {
      if (!this.times.length || b.le(a)) return new Array(12).fill(0);
      a = Frac.max(a, this.times[0]); b = Frac.min(b, this.times[this.times.length - 1]);
      if (b.le(a)) return new Array(12).fill(0);
      const i = this.bisectRight(a) - 1, j = this.bisectRight(b) - 1;
      if (i === j) return this.rate[i].map(r => b.sub(a).mul(r).num());
      const out = [];
      for (let pc = 0; pc < 12; pc++) {
        const head = this.times[i + 1].sub(a).mul(this.rate[i][pc]);
        const mid = this.cum[j][pc].sub(this.cum[i + 1][pc]);
        const tail = j < this.rate.length ? b.sub(this.times[j]).mul(this.rate[j][pc]) : F0;
        out.push(head.add(mid).add(tail).num());
      }
      return out;
    }
  }
  // D031 deployment fit: bass-line templates learned on the training + validation partitions of run full-20260905b
  // (protocol p4-key-evidence-v1, sweep run p4k-20260915a, 99 works / 1128 reference key spans).
  const DEPLOYMENT_BASS_PROFILE = {
    major: [0.223495, 0.012283, 0.096578, 0.008058, 0.113329, 0.104008, 0.019756, 0.240434, 0.019598, 0.073789, 0.013254, 0.075419],
    minor: [0.228116, 0.013769, 0.087959, 0.092331, 0.017139, 0.096376, 0.019714, 0.253927, 0.081263, 0.021004, 0.026285, 0.062115]
  };
  // D031: the bass line as its own evidence channel - lowest sounding pitch class per elementary interval.
  class BassProfileIndex {
    constructor(events) {
      const set = new Map();
      for (const e of events) { set.set(e.start.str(), e.start); set.set(e.end.str(), e.end); }
      this.times = [...set.values()].sort((a, b) => a.cmp(b));
      const n = this.times.length;
      const idx = new Map(this.times.map((t, i) => [t.str(), i]));
      const lowMidi = new Array(Math.max(n - 1, 0)).fill(null), lowPc = new Array(Math.max(n - 1, 0)).fill(null);
      for (const e of events) {
        const i = idx.get(e.start.str()), j = idx.get(e.end.str());
        for (let k = i; k < j; k++) if (lowMidi[k] === null || e.pitch.midi < lowMidi[k]) { lowMidi[k] = e.pitch.midi; lowPc[k] = e.pitch.pc; }
      }
      this.rate = Array.from({ length: Math.max(n - 1, 0) }, (_, k) => Array.from({ length: 12 }, (_, pc) => (lowPc[k] !== null && pc === lowPc[k]) ? 1 : 0));
      this.cum = [new Array(12).fill(F0)];
      for (let k = 0; k < this.rate.length; k++) { const len = this.times[k + 1].sub(this.times[k]); const prev = this.cum[k]; this.cum.push(prev.map((c, pc) => c.add(len.mul(this.rate[k][pc])))); }
    }
  }
  BassProfileIndex.prototype.bisectRight = PCProfileIndex.prototype.bisectRight;
  BassProfileIndex.prototype.profile = PCProfileIndex.prototype.profile;

  function channelScores(index, frames, window, templates) {
    return frames.map(([a, b]) => { const prof = zNorm(index.profile(Frac.max(F0, a.sub(window)), b.add(window))); return prof ? templates.map(t => t.reduce((s, x, i) => s + x * prof[i], 0)) : new Array(24).fill(0); });
  }
  // D031: how well the dictionary knows each beat's notes under each of the 24 keys (z-scored log training count).
  function dictionaryFrameEvidence(sidx, frames, dict) {
    const keys = KEY_NAMES.map((_, k) => keyFromIndex(k));
    return frames.map(([a, b]) => {
      const ft = segmentFeatures(sidx, a, b);
      if (ft.isSilent) return new Array(24).fill(0);
      const vals = keys.map(key => {
        const c = dict.entries[dictionaryInput(key.mode, ft.soundingPitches, ft.bass, key)];
        if (!c || !c.length) return 0;
        let n = 0; for (const [, cnt] of c) n += cnt;
        return Math.log1p(n);
      });
      const mean = vals.reduce((s, x) => s + x, 0) / 24;
      const centred = vals.map(x => x - mean);
      const sd = Math.sqrt(centred.reduce((s, x) => s + x * x, 0) / 24);
      return sd > 0 ? centred.map(x => x / sd) : new Array(24).fill(0);
    });
  }
  function frameScores(index, frames, window) {
    return frames.map(([a, b]) => { const prof = zNorm(index.profile(Frac.max(F0, a.sub(window)), b.add(window))); return prof ? TEMPLATES.map(t => t.reduce((s, x, i) => s + x * prof[i], 0)) : new Array(24).fill(0); });
  }
  function viterbi(scores, penalty, startAllowed) {
    const n = scores.length; if (!n) return [];
    const K = 24; let dp = scores[0].slice(); const back = [Array.from({ length: K }, (_, k) => k)];
    if (startAllowed) dp = dp.map((s, k) => startAllowed.has(k) ? s : s - penalty);   // D029: a key the signature does not allow costs one change
    for (let i = 1; i < n; i++) {
      let best = 0; for (let k = 1; k < K; k++) if (dp[k] > dp[best]) best = k;
      const sw = dp[best] - penalty; const nb = new Array(K), nd = new Array(K);
      for (let k = 0; k < K; k++) { if (sw > dp[k]) { nb[k] = best; nd[k] = scores[i][k] + sw; } else { nb[k] = k; nd[k] = scores[i][k] + dp[k]; } }
      back.push(nb); dp = nd;
    }
    let k = 0; for (let j = 1; j < K; j++) if (dp[j] > dp[k]) k = j;
    const path = new Array(n);
    for (let i = n - 1; i >= 0; i--) { path[i] = k; k = back[i][k]; }
    return path;
  }
  function signatureStartKeys(sharps) { const majorPc = mod(7 * sharps, 12); return new Set([2 * majorPc, 2 * mod(majorPc + 9, 12) + 1]); }
  function keyTimeline(index, frames, window, penalty, startAllowed) {
    if (!frames.length) return [];
    const path = viterbi(frameScores(index, frames, window), penalty, startAllowed);
    const out = [];
    frames.forEach(([a, b], i) => { const k = path[i]; if (out.length && out[out.length - 1].k === k && out[out.length - 1].end.eq(a)) out[out.length - 1].end = b; else out.push({ start: a, end: b, k }); });
    return out.map(r => ({ start: r.start, end: r.end, key: keyFromIndex(r.k) }));
  }
  function keysFromScores(frames, scores, penalty, source, startAllowed) {
    if (!frames.length) return [];
    const path = viterbi(scores, penalty, startAllowed);
    const out = [];
    frames.forEach(([a, b], i) => { const k = path[i]; if (out.length && out[out.length - 1].k === k && out[out.length - 1].end.eq(a)) out[out.length - 1].end = b; else out.push({ start: a, end: b, k }); });
    return out.map(r => ({ start: r.start, end: r.end, key: keyFromIndex(r.k, source) }));
  }
  // A reader's key: "B minor", "F# major", "Eb minor". The spelling the reader names is kept, so scale degrees count from it.
  function keyFromName(name, source) {
    const m = /^([A-G])(##|#|bb|b)? (major|minor)$/.exec(String(name || "")); if (!m) return null;
    const alter = { "": 0, "#": 1, "##": 2, "b": -1, "bb": -2 }[m[2] || ""], pc = mod(STEP_PC[m[1]] + alter, 12);
    return { tonicStep: m[1], tonicAlter: alter, tonicPc: pc, mode: m[3], source: source || "reader", name: m[1] + (m[2] || "") + " " + m[3], index: 2 * pc + (m[3] === "minor" ? 1 : 0) };
  }
  // overrides: [{ start: Frac, name }]. A reader's key holds from its start to the next key change, the tracker's or the
  // reader's own. Without overrides the timeline is returned unchanged.
  function applyKeyOverrides(timeline, overrides) {
    const ov = (overrides || []).map(o => ({ start: o.start instanceof Frac ? o.start : Frac.parse(String(o.start)), key: keyFromName(o.name) })).filter(o => o.key).sort((a, b) => a.start.cmp(b.start));
    if (!ov.length || !timeline.length) return timeline;
    const pieces = [];
    for (const r of timeline) {
      let cur = r.start, key = r.key;
      for (const o of ov) {
        if (o.start.lt(r.start) || o.start.ge(r.end)) continue;
        if (o.start.gt(cur)) pieces.push({ start: cur, end: o.start, key });
        cur = o.start; key = o.key;
      }
      pieces.push({ start: cur, end: r.end, key });
    }
    const out = [];
    for (const p of pieces) {
      const last = out[out.length - 1];
      if (last && last.key.tonicPc === p.key.tonicPc && last.key.mode === p.key.mode && last.key.tonicStep === p.key.tonicStep && last.end.eq(p.start)) last.end = p.end;
      else out.push({ start: p.start, end: p.end, key: p.key });
    }
    return out;
  }
  function keyAt(timeline, t) {
    if (!timeline.length) return null;
    let lo = 0, hi = timeline.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (timeline[mid].start.le(t)) lo = mid + 1; else hi = mid; }
    const i = lo - 1;
    if (i >= 0 && timeline[i].start.le(t) && t.lt(timeline[i].end)) return timeline[i].key;
    if (i >= 0 && t.ge(timeline[timeline.length - 1].end)) return timeline[timeline.length - 1].key;
    return null;
  }

  // ------------------------------------------------------------------ segmentation
  function beatGridBoundaries(score, unit) {
    const set = new Map();
    for (const m of score.measures) {
      if (unit === "measure") { set.set(m.start.str(), m.start); continue; }
      let step;
      if (unit === "quarter") step = new Frac(1, 1);
      else { const [num, den] = m.meter.includes("/") ? m.meter.split("/").map(x => parseInt(x, 10)) : [4, 4]; step = (den === 8 && num % 3 === 0 && num > 3) ? new Frac(3, 2) : new Frac(4, den); }
      let t = m.start; while (t.lt(m.end)) { set.set(t.str(), t); t = t.add(step); }
    }
    return [...set.values()].filter(b => b.gt(F0) && b.lt(score.scoreEnd)).sort((a, b) => a.cmp(b));
  }
  function segmentsFromBoundaries(bounds, end) {
    const pts = [F0, ...bounds.filter(b => b.gt(F0) && b.lt(end)), end]; const out = [];
    for (let i = 0; i + 1 < pts.length; i++) if (pts[i + 1].gt(pts[i])) out.push([pts[i], pts[i + 1]]);
    return out;
  }
  class SoundingIndex {
    constructor(events) { this.events = events.slice().sort((a, b) => a.start.cmp(b.start)); this.starts = this.events.map(e => e.start); this.maxend = []; let m = null; for (const e of this.events) { m = (m === null || e.end.gt(m)) ? e.end : m; this.maxend.push(m); } }
    overlapping(a, b) {
      let lo = 0, hi = this.maxend.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (this.maxend[mid].le(a)) lo = mid + 1; else hi = mid; }
      let lo2 = 0, hi2 = this.starts.length; while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (this.starts[mid].lt(b)) lo2 = mid + 1; else hi2 = mid; }
      return this.events.slice(lo, hi2).filter(e => e.end.gt(a));
    }
  }
  // D034: the bass line (same definition as src/colorkey/bassline.py). A sounding event is bass when nothing lower is
  // sounding as it starts, or when it doubles such a note one octave higher, starting with it and lasting at least as long.
  function bassLineEvents(sounding) {
    const sidx = new SoundingIndex(sounding); const tiny = new Frac(1, 1000000); const out = new Set();
    for (const ev of sounding) {
      const here = sidx.overlapping(ev.start, ev.start.add(tiny));
      if (!here.length) continue;
      const lowest = Math.min(...here.map(e => e.pitch.midi));
      if (ev.pitch.midi <= lowest) { out.add(ev); continue; }
      if (ev.pitch.midi === lowest + 12 && here.some(L => L.pitch.midi === lowest && L.start.eq(ev.start) && ev.end.ge(L.end))) out.add(ev);
    }
    return out;
  }
  function content(sidx, a, b) {
    const ev = sidx.overlapping(a, b);
    const sounding = new Set(ev.map(e => e.pitch.pc));
    const attacked = new Set(ev.filter(e => a.le(e.start) && e.start.lt(b)).map(e => e.pitch.pc));
    const atStart = ev.filter(e => e.start.le(a) && a.lt(e.end));
    let bass = null;
    if (atStart.length) { const m = atStart.reduce((best, e) => cmpPitch(e.pitch, best.pitch) < 0 ? e : best); bass = m.pitch.pc; }
    return { sounding, attacked, bass };
  }
  function cmpPitch(p, q) { return (p.midi - q.midi) || (p.step < q.step ? -1 : p.step > q.step ? 1 : 0) || (p.alter - q.alter); }
  function gatedBeatBoundaries(score, sidx, useBass) {
    const segs = segmentsFromBoundaries(beatGridBoundaries(score, "beat"), score.scoreEnd);
    if (!segs.length) return [];
    const kept = [];
    let first = content(sidx, segs[0][0], segs[0][1]); let curPcs = new Set(first.sounding), curBass = first.bass;
    for (let i = 1; i < segs.length; i++) {
      const [a, b] = segs[i]; const c = content(sidx, a, b);
      const newPc = [...c.attacked].some(pc => !curPcs.has(pc));
      const bassChanged = useBass && c.bass !== null && curBass !== null && c.bass !== curBass;
      if (newPc || bassChanged) { kept.push(a); curPcs = new Set(c.sounding); curBass = c.bass; }
      else { for (const pc of c.sounding) curPcs.add(pc); if (curBass === null) curBass = c.bass; }
    }
    return kept;
  }
  function boundariesFor(score, sidx, name) {
    if (name === "beat" || name === "quarter" || name === "measure") return beatGridBoundaries(score, name);
    if (name === "beat_gated_pc") return gatedBeatBoundaries(score, sidx, false);
    if (name === "beat_gated_pc_bass") return gatedBeatBoundaries(score, sidx, true);
    throw new Error("unknown segmenter " + name);
  }

  // ------------------------------------------------------------------ features and dictionary lookup
  const SCALE_OFFSETS = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  function spelledFeature(p, key) {
    const degree = mod(STEP_INDEX[p.step] - STEP_INDEX[key.tonicStep], 7) + 1;
    const expected = mod(key.tonicPc + SCALE_OFFSETS[key.mode][degree - 1], 12);
    const alteration = mod(p.pc - expected + 6, 12) - 6;
    return [degree, alteration];
  }
  const fmt = ([d, a]) => d + (a >= 0 ? "+" + a : String(a));
  function dictionaryInput(mode, pitches, bass, key) {
    const feats = new Map();
    for (const p of pitches) { const f = spelledFeature(p, key); feats.set(f[0] * 100 + f[1] + 50, f); }
    const sorted = [...feats.values()].sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
    const b = bass ? fmt(spelledFeature(bass, key)) : "NO_BASS_AT_START";
    return mode + "|{" + sorted.map(fmt).join(",") + "}|" + b;
  }
  function segmentFeatures(sidx, a, b) {
    const ev = sidx.overlapping(a, b);
    const sounding = ev.filter(e => e.start.lt(b) && e.end.gt(a));
    const onset = sounding.filter(e => a.le(e.start) && e.start.lt(b));
    const atStart = sounding.filter(e => e.start.le(a) && a.lt(e.end));
    const bass = atStart.length ? atStart.reduce((best, e) => cmpPitch(e.pitch, best.pitch) < 0 ? e : best).pitch : null;
    const uniq = arr => { const m = new Map(); for (const e of arr) m.set(e.pitch.name, e.pitch); return [...m.values()]; };
    return { onsetPitches: uniq(onset), soundingPitches: uniq(sounding), bass, isSilent: sounding.length === 0 };
  }
  // ---- back-off chain (D028): exact -> any_bass (bass-consistent preferred) -> drop_one -> drop_two; the dictionary
  // entries are [[label, count], ...] sorted by (-count, label), so entries[key][0] is the registered winner.
  const QUALITY_INTERVALS = { M: [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], Mm7: [0, 4, 7, 10], mm7: [0, 3, 7, 10], MM7: [0, 4, 7, 11], hdim7: [0, 3, 6, 10], dim7: [0, 3, 6, 9], mM7: [0, 3, 7, 11], aug7: [0, 4, 8, 10], augM7: [0, 4, 8, 11] };
  function theoreticalBassPc(label) {
    const f = fields(label); const ivs = QUALITY_INTERVALS[f.q];
    if (!ivs || !/^\d+$/.test(f.rpc || "") || !/^\d+$/.test(f.inv || "")) return null;
    const inv = parseInt(f.inv, 10); if (inv >= ivs.length) return null;
    return mod(parseInt(f.rpc, 10) + ivs[inv], 12);
  }
  function parseInput(inp) {
    const i = inp.indexOf("|"); const mode = inp.slice(0, i); const rest = inp.slice(i + 1);
    const j = rest.indexOf("}|"); const setPart = rest.slice(1, j); const bass = rest.slice(j + 2);
    const feats = setPart ? setPart.split(",").map(x => [parseInt(x[0], 10), parseInt(x.slice(1), 10)]) : [];
    return { mode, feats, bass: bass === "NO_BASS_AT_START" ? null : [parseInt(bass[0], 10), parseInt(bass.slice(1), 10)] };
  }
  function sortedUnique(feats) { const m = new Map(); for (const f of feats) m.set(f[0] + "|" + f[1], f); return [...m.values()].sort((x, y) => (x[0] - y[0]) || (x[1] - y[1])); }
  function makeInput(mode, feats, bass) { return mode + "|{" + sortedUnique(feats).map(fmt).join(",") + "}|" + (bass ? fmt(bass) : "NO_BASS_AT_START"); }
  function relPcOf(mode, f) { return mod(SCALE_OFFSETS[mode][f[0] - 1] + f[1], 12); }
  function winnerOf(counter) {   // counter: array of [label, count]; max count, ties -> lexicographically smallest label
    let top = -1; for (const [, n] of counter) if (n > top) top = n;
    let best = null; for (const [l, n] of counter) if (n === top && (best === null || l < best)) best = l;
    return [best, top];
  }
  function massesOf(counter, label) {
    let total = 0, rm = 0, fm = 0; const root = fields(label).root, fc = functionCategory(label);
    for (const [l, n] of counter) { total += n; if (fields(l).root === root) rm += n; if (functionCategory(l) === fc) fm += n; }
    return [rm / total, fm / total];
  }
  function packPrediction(level, counter, label, top, extra) {
    let total = 0; for (const [, n] of counter) total += n;
    const [rm, fm] = massesOf(counter, label);
    const alts = counter.filter(([l]) => l !== label).sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).slice(0, 5).map(([l, n]) => ({ label: l, count: n }));
    return [label, Object.assign({ status: "predicted", level, support: total, frequency: top / total, nLabels: counter.length, topCount: top, rootMass: rm, functionMass: fm, alternatives: alts }, extra)];
  }
  class BackoffPredictor {
    constructor(dict, levels) {
      this.dict = dict; this.levels = levels || ["exact", "any_bass", "drop_one", "drop_two"];
      this.anyBass = new Map();
      if (this.levels.includes("any_bass")) {
        for (const key in dict.entries) {
          const i = key.indexOf("|"); const rest = key.slice(i + 1); const agg = key.slice(0, i) + "|" + rest.slice(0, rest.indexOf("}|") + 1);
          if (!this.anyBass.has(agg)) this.anyBass.set(agg, new Map());
          const m = this.anyBass.get(agg);
          for (const [l, n] of dict.entries[key]) m.set(l, (m.get(l) || 0) + n);
        }
      }
    }
    // Every label counted at the level predict() answers from, as [[label, count]]; null where predict() abstains.
    candidates(inp) {
      const { mode, feats, bass } = parseInput(inp);
      if (this.levels.includes("exact")) { const c = this.dict.entries[inp]; if (c && c.length) return c; }
      if (this.levels.includes("any_bass")) {
        const m = this.anyBass.get(mode + "|{" + sortedUnique(feats).map(fmt).join(",") + "}");
        if (m && m.size) {
          const c = [...m.entries()];
          if (bass) { const bpc = relPcOf(mode, bass); const consistent = c.filter(([l]) => theoreticalBassPc(l) === bpc); if (consistent.length) return consistent; }
          return c;
        }
      }
      for (const [level, k] of [["drop_one", 1], ["drop_two", 2]]) {
        if (!this.levels.includes(level) || feats.length < k + 1) continue;
        const removable = sortedUnique(feats).filter(f => !bass || !(f[0] === bass[0] && f[1] === bass[1]));
        let best = null; const combos = [];
        if (k === 1) for (let i = 0; i < removable.length; i++) combos.push([removable[i]]);
        else for (let i = 0; i < removable.length; i++) for (let j = i + 1; j < removable.length; j++) combos.push([removable[i], removable[j]]);
        for (const combo of combos) {
          const sub = feats.filter(g => !combo.some(f => f[0] === g[0] && f[1] === g[1]));
          const c = this.dict.entries[makeInput(mode, sub, bass)];
          if (c && c.length) { let total = 0; for (const [, n] of c) total += n; if (best === null || total > best[0]) best = [total, c]; }
        }
        if (best) return best[1];
      }
      return null;
    }
    predict(inp) {
      const { mode, feats, bass } = parseInput(inp);
      if (this.levels.includes("exact")) { const c = this.dict.entries[inp]; if (c && c.length) { const [lab, top] = winnerOf(c); return packPrediction("exact", c, lab, top, { input: inp }); } }
      if (this.levels.includes("any_bass")) {
        const m = this.anyBass.get(mode + "|{" + sortedUnique(feats).map(fmt).join(",") + "}");
        if (m && m.size) {
          const c = [...m.entries()];
          let aggregate = 0; for (const [, n] of c) aggregate += n;
          if (bass) { const bpc = relPcOf(mode, bass); const consistent = c.filter(([l]) => theoreticalBassPc(l) === bpc); if (consistent.length) { const [lab, top] = winnerOf(consistent); return packPrediction("any_bass", consistent, lab, top, { input: inp, bassConsistent: true, aggregateSupport: aggregate }); } }
          const [lab, top] = winnerOf(c); return packPrediction("any_bass", c, lab, top, { input: inp, bassConsistent: false, aggregateSupport: aggregate });
        }
      }
      for (const [level, k] of [["drop_one", 1], ["drop_two", 2]]) {
        if (!this.levels.includes(level) || feats.length < k + 1) continue;
        const removable = sortedUnique(feats).filter(f => !bass || !(f[0] === bass[0] && f[1] === bass[1]));
        let best = null;
        const combos = [];
        if (k === 1) for (let i = 0; i < removable.length; i++) combos.push([removable[i]]);
        else for (let i = 0; i < removable.length; i++) for (let j = i + 1; j < removable.length; j++) combos.push([removable[i], removable[j]]);
        for (const combo of combos) {
          const sub = feats.filter(g => !combo.some(f => f[0] === g[0] && f[1] === g[1]));
          const c = this.dict.entries[makeInput(mode, sub, bass)];
          if (c && c.length) { let total = 0; for (const [, n] of c) total += n; if (best === null || total > best[0]) best = [total, combo, c]; }
        }
        if (best) { const [, removed, c] = best; const [lab, top] = winnerOf(c); return packPrediction(level, c, lab, top, { input: inp, removed: removed.map(fmt).join(",") }); }
      }
      return [null, { status: "unseen", level: null, support: 0, frequency: null, nLabels: 0, input: inp }];
    }
  }
  function cueNeeded(info, view, threshold) {
    if (!info || info.status !== "predicted") return !info || info.status === "unseen";
    if (info.level !== "exact") return true;
    const mass = view === "function" ? info.functionMass : info.rootMass;
    return mass !== null && mass !== undefined && mass < threshold;
  }
  // ------------------------------------------------------------------ progression context (p8-progression-v1)
  // The step from each chord to the next, counted in the expert analyses on the analyzer's own segments, and a decoder
  // that reads a whole piece at once (src/colorkey/progression.py is the reference; sums are kept identical).
  function rootOf(label) { const i = label.indexOf("root="); const j = label.indexOf(";", i); return i >= 0 ? label.slice(i + 5, j) : "?"; }
  const rlog = x => Math.round(Math.log(x) * 1e6) / 1e6;
  class ProgressionModel {
    constructor(d) {
      this.labels = d.labels; this.n = d.n; this.uni = new Map(); this.bi = new Map(); this.ctx = new Map();
      this.rootUni = new Map(); this.rootBi = new Map(); this.rootCtx = new Map(); this.onRoot = new Map();
      const inc = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
      d.labels.forEach((l, i) => { this.uni.set(l, d.uni[i]); inc(this.rootUni, rootOf(l), d.uni[i]); inc(this.onRoot, rootOf(l), 1); });
      for (const a in d.bi) {
        const la = d.labels[+a], ra = rootOf(la); const row = new Map(); this.bi.set(la, row);
        if (!this.rootBi.has(ra)) this.rootBi.set(ra, new Map());
        for (const [b, n] of d.bi[a]) { const lb = d.labels[b]; row.set(lb, n); inc(this.ctx, la, n); inc(this.rootBi.get(ra), rootOf(lb), n); inc(this.rootCtx, ra, n); }
      }
    }
    pLabel(y) { return ((this.uni.get(y) || 0) + 0.5) / (this.n + 0.5 * (this.uni.size + 1)); }
    pRootStep(rPrev, r, kappaRoot) {
      const pR = ((this.rootUni.get(r) || 0) + 0.5) / (this.n + 0.5 * (this.rootUni.size + 1));
      const row = this.rootBi.get(rPrev);
      return (((row && row.get(r)) || 0) + kappaRoot * pR) / ((this.rootCtx.get(rPrev) || 0) + kappaRoot);
    }
    pStep(prev, y, kappa, kappaRoot) {
      if (prev === null) return this.pLabel(y);
      const rPrev = rootOf(prev), r = rootOf(y);
      const pInRoot = ((this.uni.get(y) || 0) + 0.5) / ((this.rootUni.get(r) || 0) + 0.5 * ((this.onRoot.get(r) || 0) + 1));
      const backoff = this.pRootStep(rPrev, r, kappaRoot) * pInRoot;
      const row = this.bi.get(prev);
      return (((row && row.get(y)) || 0) + kappa * backoff) / ((this.ctx.get(prev) || 0) + kappa);
    }
  }
  function emissionOf(cands, alpha) {
    const order = cands.slice().sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    let total = 0; for (const [, n] of order) total += n;
    return order.map(([l, n]) => [l, rlog((n + alpha) / (total + alpha * order.length))]);
  }
  // segments: [{ cands: [[label, count]] | null, key: string | null }] -> the chosen label per segment (null without candidates)
  function decodeProgression(segments, model, weight, kappa, prior, alpha, kappaRoot) {
    if (alpha === undefined) alpha = 0.5; if (kappaRoot === undefined) kappaRoot = 5.0; prior = prior || 0;
    const out = new Array(segments.length).fill(null), cache = new Map();
    const step = (prev, y) => {
      const k = prev + "\u0001" + y; let v = cache.get(k);
      if (v === undefined) { v = rlog(model.pStep(prev, y, kappa, kappaRoot)); if (prior) v = Math.round((v - prior * rlog(model.pLabel(y))) * 1e6) / 1e6; cache.set(k, v); }
      return v;
    };
    let i = 0; const n = segments.length;
    while (i < n) {
      if (!segments[i].cands || !segments[i].cands.length) { i += 1; continue; }
      let j = i;
      while (j + 1 < n && segments[j + 1].cands && segments[j + 1].cands.length && segments[j + 1].key === segments[i].key) j += 1;
      const em = []; for (let t = i; t <= j; t++) em.push(emissionOf(segments[t].cands, alpha));
      let best = em[0].map(([, e]) => e); const back = [];
      for (let t = 1; t < em.length; t++) {
        const prevLabels = em[t - 1].map(x => x[0]); const cur = [], bp = [];
        for (const [l, e] of em[t]) {
          let top = null, arg = 0;
          for (let a = 0; a < prevLabels.length; a++) { const v = best[a] + (weight ? weight * step(prevLabels[a], l) : 0.0); if (top === null || v > top) { top = v; arg = a; } }
          cur.push(top + e); bp.push(arg);
        }
        best = cur; back.push(bp);
      }
      let a = 0; for (let q = 1; q < best.length; q++) if (best[q] > best[a]) a = q;
      for (let t = em.length - 1; t >= 0; t--) { out[i + t] = em[t][a][0]; if (t) a = back[t - 1][a]; }
      i = j + 1;
    }
    return out;
  }
  function applyProgression(raw, prog) {
    const model = prog.model instanceof ProgressionModel ? prog.model : (prog.model = new ProgressionModel(prog.model));
    const segs = raw.map(r => ({ cands: r.info.status === "predicted" ? r.info.cands : null, key: r.key ? r.key.tonicStep + "|" + r.key.tonicAlter + "|" + r.key.mode : null }));
    const chosen = decodeProgression(segs, model, prog.weight, prog.kappa, prog.prior || 0);
    raw.forEach((r, i) => {
      const y = chosen[i], cands = r.info.cands; delete r.info.cands;
      if (y === null || y === r.label) return;
      let total = 0, cy = 0; for (const [l, n] of cands) { total += n; if (l === y) cy = n; }
      const [rm, fm] = massesOf(cands, y);
      r.info.byContext = true; r.info.notesAlone = r.label; r.info.topCount = cy; r.info.frequency = cy / total; r.info.rootMass = rm; r.info.functionMass = fm;
      r.info.alternatives = cands.filter(([l]) => l !== y).sort((x, z) => (z[1] - x[1]) || (x[0] < z[0] ? -1 : x[0] > z[0] ? 1 : 0)).slice(0, 5).map(([l, n]) => ({ label: l, count: n }));
      r.label = y;
    });
    return raw;
  }
  function labelSegments(sidx, segs, keyFn, dict, collection, backoff, withCandidates) {
    const out = [];
    const predictor = new BackoffPredictor(dict, backoff ? undefined : ["exact"]);
    for (const [a, b] of segs) {
      const ft = segmentFeatures(sidx, a, b);
      const k = keyFn(a);
      if (ft.isSilent) { out.push({ start: a, end: b, label: null, key: k, info: { status: "silent" } }); continue; }
      if (!k) { out.push({ start: a, end: b, label: null, key: null, info: { status: "no_key" } }); continue; }
      const pitches = collection === "onset_only" ? ft.onsetPitches : ft.soundingPitches;
      const input = dictionaryInput(k.mode, pitches, ft.bass, k);
      const [label, info] = predictor.predict(input);
      info.observedBass = ft.bass ? ft.bass.name : null;
      if (withCandidates) info.cands = predictor.candidates(input);
      out.push({ start: a, end: b, label, key: k, info });
    }
    return out;
  }

  // ------------------------------------------------------------------ labels, views, text
  function fields(label) { const f = {}; for (const part of label.split(";")) { const i = part.indexOf("="); f[part.slice(0, i)] = part.slice(i + 1); } return f; }
  const ROMAN = { 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII" };
  const INV_FIG = { triad: { 0: "", 1: "6", 2: "64" }, seventh: { 0: "7", 1: "65", 2: "43", 3: "2" } };
  function labelToRnText(label) {
    if (!label) return "?";
    const f = fields(label);
    const deg = parseInt(f.root[0], 10), alt = parseInt(f.root.slice(1), 10);
    if (!(deg >= 1 && deg <= 7)) return "?";
    const q = f.q || "", inv = parseInt(f.inv || "0", 10);
    const acc = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "##" }[String(alt)] || "";
    if (q === "It6" || q === "Ger6" || q === "Fr6") return q;
    const upper = ["M", "aug", "Mm7", "MM7", "aug7", "augM7"].includes(q);
    const numeral = upper ? ROMAN[deg] : ROMAN[deg].toLowerCase();
    const suffix = { dim: "o", dim7: "o", hdim7: "ø", aug: "+", aug7: "+", augM7: "+M" }[q] || "";
    const seventh = ["Mm7", "MM7", "mm7", "mM7", "dim7", "hdim7", "aug7", "augM7"].includes(q);
    let fig = (seventh ? INV_FIG.seventh : INV_FIG.triad)[inv]; if (fig === undefined) fig = String(inv);
    if ((q === "MM7" || q === "mM7") && inv === 0) fig = "M7";
    const extras = (f.add || "").split(",").filter(Boolean).map(x => "[add" + x + "]").join("") + (f.omit || "").split(",").filter(Boolean).map(x => "[no" + x + "]").join("");
    const tag = (f.tags || "").includes("cad64") ? " (cad)" : "";
    return acc + numeral + suffix + fig + extras + tag;
  }
  function functionCategory(label) {
    if (!label) return null;
    const f = fields(label);
    const deg = parseInt(f.root[0], 10), alt = parseInt(f.root.slice(1), 10);
    if (!(deg >= 1 && deg <= 7)) return "ambiguous";
    const q = f.q || "", chain = f.chain || "", tags = f.tags || "";
    if (tags.includes("cad64")) return "D";
    if (chain !== "" && chain !== "?") return "applied";
    if (q === "It6" || q === "Ger6" || q === "Fr6") return "PD";
    if (deg === 1 && alt === 0) return "T";
    if (deg === 6 && alt === 0) return "T";
    if (deg === 2 && (alt === 0 || alt === -1)) return "PD";
    if (deg === 4 && alt === 0) return "PD";
    if (deg === 5 && alt === 0) return "D";
    if (deg === 7) return ["dim", "dim7", "hdim7"].includes(q) ? "D" : "ambiguous";
    return "ambiguous";
  }
  const DEGREE_PALETTE = { 1: "#0072B2", 2: "#E69F00", 3: "#009E73", 4: "#CC79A7", 5: "#D55E00", 6: "#56B4E9", 7: "#F0E442" };
  const FUNCTION_PALETTE = { T: "#0072B2", PD: "#009E73", D: "#D55E00", applied: "#E69F00", ambiguous: "#CC79A7" };
  const UNLABELLED = "#999999";
  const FUNCTION_RULES = "cad64 tag -> D; applied chain -> applied; augmented sixth -> PD; 1 -> T; 6 (unaltered) -> T; 2 and b2 -> PD; 4 (unaltered) -> PD; 5 (unaltered) -> D; 7 diminished -> D; 7 other, 3 and altered degrees -> ambiguous";
  const VIEWS = { degree: { concept: "root_degree_in_local_key", legend: "1 blue, 2 orange, 3 green, 4 pink, 5 vermilion, 6 sky, 7 yellow; grey = no label" },
                  function: { concept: "broad_function_from_root_degree_quality_and_tags", legend: "T blue, PD green, D vermilion, applied orange, ambiguous pink; grey = no label" } };
  function hexFor(label, view) {
    if (!label) return UNLABELLED;
    if (view === "function") return FUNCTION_PALETTE[functionCategory(label)] || UNLABELLED;
    const deg = parseInt(fields(label).root[0], 10);
    return DEGREE_PALETTE[deg] || UNLABELLED;
  }
  function spanText(s, keyChanged, view, confidentFrequency) {
    let core;
    if (s.status === "unseen" || (!s.label && s.status !== "no_chord" && s.status !== "silent")) core = "?";
    else if (s.status === "silent" && !s.label) core = "(rest)";
    else core = s.label ? labelToRnText(s.label) : "N.C.";
    if (view === "function" && s.label) core = core + " [" + functionCategory(s.label) + "]";
    const cueFlag = view === "function" ? s.cueFunction : s.cueDegree;
    if (confidentFrequency !== null && confidentFrequency !== undefined) {
      if (cueFlag !== undefined) { if (cueFlag && s.label) core = core + " ?"; }
      else if (s.confidence !== null && s.confidence !== undefined && s.confidence < confidentFrequency) core = core + " ?";
    }
    return keyChanged && s.keyName ? s.keyName + ": " + core : core;
  }

  // ------------------------------------------------------------------ analyzer
  const DEFAULT_CONFIG = { predictor: "spelled+all_sounding", keyWindow: "16/1", keyPenalty: 8.0, segmenter: "beat_gated_pc_bass", mergeIdentical: true, confidentFrequency: 0.7,
                           backoff: true, keyStartPrior: false,
                           // D031: key evidence selected on the validation partition (protocol p4-key-evidence-v1, run p4k-20260915a)
                           keyProfile: "aarden", keyProfileData: null, keyBassWeight: 0.5, keyBassProfile: DEPLOYMENT_BASS_PROFILE, keyDictWeight: 0.5 };
  function analyze(score, dict, config) {
    const cfg = Object.assign({}, DEFAULT_CONFIG, config || {});
    const pidx = new PCProfileIndex(score.sounding), sidx = new SoundingIndex(score.sounding);
    const frames = segmentsFromBoundaries(beatGridBoundaries(score, "beat"), score.scoreEnd);
    const startAllowed = cfg.keyStartPrior && score.keySignatures && score.keySignatures.length ? signatureStartKeys(score.keySignatures[0].sharps) : null;
    const window = Frac.parse(cfg.keyWindow);
    let keys;
    if (cfg.keyProfile === "kk" && !cfg.keyBassWeight && !cfg.keyDictWeight) {
      keys = keyTimeline(pidx, frames, window, cfg.keyPenalty, startAllowed);
    } else {
      const chans = [cfg.keyProfile];
      let scores = channelScores(pidx, frames, window, profileTemplates(cfg.keyProfile, cfg.keyProfileData));
      if (cfg.keyBassWeight) {
        if (!cfg.keyBassProfile) throw new Error("keyBassWeight is set but keyBassProfile is missing");
        const bt = templatesFrom(cfg.keyBassProfile.major, cfg.keyBassProfile.minor);
        const bs = channelScores(new BassProfileIndex(score.sounding), frames, window, bt);
        scores = scores.map((row, i) => row.map((x, k) => x + cfg.keyBassWeight * bs[i][k]));
        chans.push("bass");
      }
      if (cfg.keyDictWeight) {
        const de = dictionaryFrameEvidence(sidx, frames, dict);
        scores = scores.map((row, i) => row.map((x, k) => x + cfg.keyDictWeight * de[i][k]));
        chans.push("dict");
      }
      keys = keysFromScores(frames, scores, cfg.keyPenalty, "estimated:" + chans.join("+") + "_viterbi", startAllowed);
    }
    if (cfg.keyOverrides && cfg.keyOverrides.length) keys = applyKeyOverrides(keys, cfg.keyOverrides);
    const segs = segmentsFromBoundaries(boundariesFor(score, sidx, cfg.segmenter), score.scoreEnd);
    const collection = cfg.predictor.split("+")[1];
    const prog = cfg.progression && cfg.progression.weight ? cfg.progression : null;      // { model, weight, kappa, prior }
    const raw = labelSegments(sidx, segs, t => keyAt(keys, t), dict, collection, !!cfg.backoff, !!prog);
    if (prog) applyProgression(raw, prog);
    const merged = [];
    for (const r of raw) {
      const last = merged[merged.length - 1];
      const sameKey = last && ((last.key === null && r.key === null) || (last.key && r.key && last.key.tonicPc === r.key.tonicPc && last.key.mode === r.key.mode));
      if (cfg.mergeIdentical && last && last.label === r.label && sameKey && last.end.eq(r.start) && last.info.status === r.info.status) last.end = r.end;
      else merged.push({ start: r.start, end: r.end, label: r.label, key: r.key, info: r.info });
    }
    const spans = merged.map((m, i) => ({ id: "p" + i, start: m.start, end: m.end, label: m.label, figure: m.label ? labelToRnText(m.label) : null, key: m.key, keyName: m.key ? m.key.name : null,
      status: { predicted: "valid", unseen: "unseen", silent: "silent", no_key: "missing" }[m.info.status], confidenceKind: m.label ? "training_frequency" : null,
      confidence: m.label ? m.info.frequency : null, support: m.info.support || 0, alternatives: m.info.alternatives || [], input: m.info.input || null, observedBass: m.info.observedBass || null,
      evidence: { level: m.info.level || null, rootMass: m.info.rootMass === undefined ? null : m.info.rootMass, functionMass: m.info.functionMass === undefined ? null : m.info.functionMass, removed: m.info.removed || null, bassConsistent: m.info.bassConsistent === undefined ? null : m.info.bassConsistent, support: m.info.support || 0,
                  byContext: !!m.info.byContext, notesAlone: m.info.notesAlone || null },
      cueDegree: cueNeeded(m.info, "degree", cfg.confidentFrequency), cueFunction: cueNeeded(m.info, "function", cfg.confidentFrequency),
      endProvenance: i + 1 < merged.length ? "next_segment" : "score_end" }));
    const diagnostics = { config: cfg, nFrames: frames.length, nKeyRegions: keys.length, nSegmentsRaw: raw.length, nSpansMerged: merged.length,
      nUnseenRaw: raw.filter(r => r.info.status === "unseen").length, nSilentRaw: raw.filter(r => r.info.status === "silent").length,
      nLowFrequencySpans: spans.filter(s => s.confidence !== null && s.confidence < cfg.confidentFrequency).length,
      levels: { exact: raw.filter(r => r.info.level === "exact").length, any_bass: raw.filter(r => r.info.level === "any_bass").length, drop_one: raw.filter(r => r.info.level === "drop_one").length, drop_two: raw.filter(r => r.info.level === "drop_two").length },
      cues: { degree: spans.filter(s => s.cueDegree).length, function: spans.filter(s => s.cueFunction).length,
              reasons: { unseen: spans.filter(s => s.status === "unseen").length, backoff: spans.filter(s => s.status === "valid" && s.evidence.level !== "exact").length,
                         weakDegree: spans.filter(s => s.status === "valid" && s.evidence.level === "exact" && s.cueDegree).length, weakFunction: spans.filter(s => s.status === "valid" && s.evidence.level === "exact" && s.cueFunction).length } },
      unseenDuration: raw.filter(r => r.info.status === "unseen").reduce((acc, r) => acc.add(r.end.sub(r.start)), F0), dictionaryHash: dict.hash, dictionaryPartitions: dict.partitions };
    return { keys, raw, spans, diagnostics };
  }

  // ------------------------------------------------------------------ colouring (edits a copy of the DOM)
  function colorScore(score, spans, options) {
    const opt = Object.assign({ view: "degree", confidentFrequency: 0.5, stripSourceHarmony: true, legend: true }, options || {});
    const doc = score.doc.cloneNode(true);
    // map original notation elements to the clone by document order of <note> elements
    const origNotes = [...score.doc.getElementsByTagName("note")], cloneNotes = [...doc.getElementsByTagName("note")];
    const cloneOf = new Map(); origNotes.forEach((n, i) => cloneOf.set(n, cloneNotes[i]));
    let nHarmony = 0;
    if (opt.stripSourceHarmony) for (const h of [...doc.getElementsByTagName("harmony")]) { nHarmony += 1; h.parentNode.removeChild(h); }
    const starts = spans.map(s => s.start);
    function spanAt(t) { let lo = 0, hi = starts.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid].le(t)) lo = mid + 1; else hi = mid; } const i = lo - 1; return (i >= 0 && spans[i].start.le(t) && t.lt(spans[i].end)) ? spans[i] : null; }
    const perColor = {}; let nColored = 0, nGrace = 0;
    for (const r of score.notation) {
      if (r.isRest) continue;
      const el = cloneOf.get(r.el); if (!el) continue;
      const sp = spanAt(r.onset); const col = sp ? hexFor(sp.label, opt.view) : UNLABELLED;
      el.setAttribute("color", col);
      const nh = child(el, "notehead"); if (nh) nh.setAttribute("color", col);
      nColored += 1; if (r.isGrace) nGrace += 1; perColor[col] = (perColor[col] || 0) + 1;
    }
    // label text at span starts in the first part; legend below the last part
    const partEls = children(doc.documentElement, "part");
    const first = partEls[0]; const measureEls = children(first, "measure");
    const byMeasure = new Map(); let prevKey = null;
    for (const s of spans) {
      let mi = 1; for (const m of score.measures) if (m.start.le(s.start)) mi = m.index;
      const off = s.start.sub(score.measures[mi - 1].start);
      const changed = s.keyName !== prevKey;
      if (!byMeasure.has(mi)) byMeasure.set(mi, []);
      byMeasure.get(mi).push({ off, text: spanText(s, changed, opt.view, opt.confidentFrequency), color: hexFor(s.label, opt.view) });
      prevKey = s.keyName;
    }
    let nLabels = 0;
    let divisions = 1;
    measureEls.forEach((mx, idx) => {
      const att = child(mx, "attributes"); if (att && childText(att, "divisions")) divisions = parseInt(childText(att, "divisions"), 10);
      const items = byMeasure.get(idx + 1); if (!items) return;
      let insertAt = 0; const kids = [...mx.children];
      kids.forEach((c, i) => { if ((c.localName === "attributes" || c.localName === "print" || c.localName === "barline") && c.getAttribute("location") !== "right") insertAt = i + 1; });
      items.sort((a, b) => a.off.cmp(b.off));
      for (const it of items) {
        const d = doc.createElement("direction"); d.setAttribute("placement", "above");
        const dt = doc.createElement("direction-type"); const w = doc.createElement("words"); w.setAttribute("color", it.color); w.setAttribute("font-weight", "bold"); w.textContent = it.text; dt.appendChild(w); d.appendChild(dt);
        if (it.off.gt(F0)) { const o = doc.createElement("offset"); o.textContent = String(Math.round(it.off.mul(divisions).num())); d.appendChild(o); }
        const st = doc.createElement("staff"); st.textContent = "1"; d.appendChild(st);
        const refNode = mx.children[insertAt] || null; mx.insertBefore(d, refNode); insertAt += 1; nLabels += 1;
      }
    });
    let legend = "Color Key — notehead colour = " + VIEWS[opt.view].concept.replace(/_/g, " ") + " (" + VIEWS[opt.view].legend + ")";
    if (opt.view === "function") legend += " Rules: " + FUNCTION_RULES + ".";
    if (opt.confidentFrequency !== null && opt.confidentFrequency !== undefined) legend += " '?' = no dictionary entry, a label found by back-off (nearest entry), or fewer than " + Math.round(100 * opt.confidentFrequency) + "% of the training votes behind this colour.";
    const last = partEls[partEls.length - 1]; const lastMeasures = children(last, "measure");
    if (opt.legend && lastMeasures.length) {
      const d = doc.createElement("direction"); d.setAttribute("placement", "below");
      const dt = doc.createElement("direction-type"); const w = doc.createElement("words"); w.setAttribute("font-size", "8"); w.textContent = legend; dt.appendChild(w); d.appendChild(dt);
      const stv = last.querySelector("measure > attributes > staves"); const st = doc.createElement("staff"); st.textContent = stv && stv.textContent ? stv.textContent : "1"; d.appendChild(st);
      let insertAt = 0; [...lastMeasures[0].children].forEach((c, i) => { if (c.localName === "attributes" || c.localName === "print" || c.localName === "barline") insertAt = i + 1; });
      lastMeasures[0].insertBefore(d, lastMeasures[0].children[insertAt] || null);
    }
    const xml = new XMLSerializer().serializeToString(doc);
    const xmlText = xml.startsWith("<?xml") ? xml : '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
    return { xmlText, doc, report: { view: opt.view, concept: VIEWS[opt.view].concept, nColored, nGrace, nLabels, colors: perColor, legend, sourceHarmonyRemoved: nHarmony } };
  }
  function verifyInvariants(original, colored) {
    const key = r => [r.locator, r.onset.str(), r.duration.str(), r.written ? r.written.name : "-", r.tie || "-", r.isRest ? 1 : 0, r.isGrace ? 1 : 0].join("|");
    const a = original.notation.map(key).sort(), b = colored.notation.map(key).sort();
    const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
    return { notationIdentical: same(a, b), nOriginal: a.length, nColored: b.length, scoreEndIdentical: original.scoreEnd.eq(colored.scoreEnd),
             measuresIdentical: same(original.measures.map(m => m.index + "|" + m.start.str() + "|" + m.end.str()), colored.measures.map(m => m.index + "|" + m.start.str() + "|" + m.end.str())),
             soundingIdentical: same(original.sounding.map(e => e.start.str() + "|" + e.end.str() + "|" + e.pitch.midi).sort(), colored.sounding.map(e => e.start.str() + "|" + e.end.str() + "|" + e.pitch.midi).sort()) };
  }

  // ------------------------------------------------------------------ Color Key language v0.2 (exact port of src/colorkey/language.py)
  const L_SEVENTH = new Set(["Mm7", "MM7", "mm7", "mM7", "dim7", "hdim7", "aug7", "augM7"]);
  const L_DIM = new Set(["dim", "dim7", "hdim7"]);
  const L_AUG6 = new Set(["It6", "Ger6", "Fr6"]);
  const L_UPPER = new Set(["M", "aug", "Mm7", "MM7", "aug7", "augM7"]);
  const DEGREE_FAMILY = { 1: "tonic", 2: "supertonic", 3: "mediant", 4: "subdominant", 5: "dominant", 6: "submediant", 7: "subtonic" };
  const TARGET_UPPER = { major: { 1: true, 2: false, 3: false, 4: true, 5: true, 6: false, 7: false }, minor: { 1: false, 2: false, 3: true, 4: false, 5: true, 6: true, 7: true } };
  function degAlt(s) { return [parseInt(String(s)[0], 10), parseInt(String(s).slice(1), 10)]; }
  function isSeventh(label) {
    if (!label) return false;
    const f = fields(label), q = f.q || "";
    if (L_SEVENTH.has(q) || q === "Ger6" || q === "Fr6") return true;
    if (q.startsWith("other:") && !q.includes("7=None")) return true;
    return (f.ext || "").split(",").some(e => e === "9" || e === "11" || e === "13");
  }
  function isAppliedLabel(label) { const c = fields(label).chain || ""; return !(c === "" || c === "?" || c === "1+0"); }
  // The assignment of chords to families. The default reproduces language.py; a page may pass another table (lang.assign)
  // so that a musician can change which family a chord belongs to without touching the code.
  const DEFAULT_ASSIGN = { degree: DEGREE_FAMILY, aug6: "applied", applied: "applied", cad64: "tonic", cad64Bass: "dominant", flat2: "neapolitan",
                           dimLeading: "dominant", dim2: "supertonic", dimOther: "applied", seventhShade: true };
  function familyOf(label, mode, assign) {
    const A = assign || DEFAULT_ASSIGN;
    if (!label) return "unknown";
    const f = fields(label);
    if (!f.root) return "unknown";
    const [deg, alt] = degAlt(f.root);
    if (isNaN(deg) || isNaN(alt)) return "unknown";
    const q = f.q || "", tags = f.tags || "", applied = isAppliedLabel(label);
    if (L_AUG6.has(q) || tags.startsWith("aug6")) return A.aug6;
    if (applied && ["5", "7"].includes((f.deg || "").slice(0, 1))) return A.applied;
    if (tags.includes("cad64") && !applied) return A.cad64;
    if (deg === 2 && alt === -1) return A.flat2;
    if (L_DIM.has(q)) {
      const lead = mode === "major" ? [7, 0] : [7, 1];
      if (deg === lead[0] && alt === lead[1]) return A.dimLeading;
      if (deg === 2 && alt === 0) return A.dim2;
      return A.dimOther;
    }
    return A.degree[deg] || "unknown";
  }
  function numeralText(deg, alt, upper, minorContext) {
    let acc = { "-2": "bb", "-1": "b", "0": "", "1": "#", "2": "##" }[String(alt)] || "";
    if (deg === 7 && minorContext && alt === 1) acc = "";
    return [acc, upper ? ROMAN[deg] : ROMAN[deg].toLowerCase()];
  }
  function labelParts(label, mode) {
    if (!label) return null;
    const f = fields(label), q = f.q || "", tags = f.tags || "";
    const inv = parseInt(f.inv || "0", 10) || 0;
    const ds = f.deg || f.root; if (!ds) return null;
    const [pdeg, palt] = degAlt(ds); if (isNaN(pdeg) || isNaN(palt) || !ROMAN[pdeg]) return null;
    const chain = isAppliedLabel(label) ? (f.chain || "").split("/").filter(Boolean) : [];
    const parts = { acc: "", numeral: "", quality: "", figures: [], adds: "", target: "", special: "" };
    if (L_AUG6.has(q)) {
      parts.special = q.slice(0, -1);
      const tbl = { It6: { 0: [], 1: ["6"], 2: ["6", "4"] }, Ger6: { 0: ["7"], 1: ["6", "5"], 2: ["4", "3"], 3: ["4", "2"] }, Fr6: { 0: ["7"], 1: ["6", "5"], 2: ["4", "3"], 3: ["4", "2"] } };
      parts.figures = (tbl[q][inv] || []).slice();
    } else {
      let minorContext;
      if (chain.length) { const td = degAlt(chain[0])[0]; const v = TARGET_UPPER[mode || "major"][td]; minorContext = !(v === undefined ? true : v); }
      else minorContext = mode === "minor";
      if (pdeg === 2 && palt === -1 && !chain.length) parts.numeral = "N";
      else { const r = numeralText(pdeg, palt, L_UPPER.has(q), minorContext); parts.acc = r[0]; parts.numeral = r[1]; }
      parts.quality = { dim: "o", dim7: "o", hdim7: "ø", aug: "+", aug7: "+", augM7: "+" }[q] || "";
      if (q === "MM7" || q === "mM7" || q === "augM7") parts.quality += "M";
      if (L_SEVENTH.has(q)) {
        parts.figures = ({ 0: ["7"], 1: ["6", "5"], 2: ["4", "3"], 3: ["4", "2"] }[inv] || []).slice();
        const exts = (f.ext || "").split(",").filter(Boolean);
        if (inv === 0 && exts.length) parts.figures = [String(Math.max(...exts.map(e => parseInt(e, 10))))];
      } else parts.figures = ({ 0: [], 1: ["6"], 2: ["6", "4"] }[inv] || []).slice();
    }
    const adds = (f.add || "").split(",").filter(Boolean);
    if (adds.length && !tags.includes("cad64")) {
      const num = a => parseInt(a.replace(/\D/g, "") || "0", 10);
      parts.adds = "(" + adds.slice().sort((a, b) => num(b) - num(a)).join("") + ")";
    }
    if (chain.length) {
      parts.target = "/" + chain.map((c, i) => {
        const [d, a] = degAlt(c); const last = i === chain.length - 1;
        let upper = true; if (last) { const v = TARGET_UPPER[mode || "major"][d]; upper = v === undefined ? true : v; }
        if (a !== 0 && last) upper = a < 0;
        return ({ "-1": "b", "1": "#" }[String(a)] || "") + (upper ? ROMAN[d] : ROMAN[d].toLowerCase());
      }).join("/");
    }
    return parts;
  }
  function keyPrefix(key) {
    if (!key) return null;
    const letter = key.mode === "minor" ? key.tonicStep.toLowerCase() : key.tonicStep.toUpperCase();
    return letter + ({ "-1": "b", "1": "#", "-2": "bb", "2": "##" }[String(key.tonicAlter)] || "") + ":";
  }
  function campaniaText(parts, prefix, cue) {
    let core;
    if (!parts) core = "?";
    else { core = (parts.special || (parts.acc + parts.numeral + parts.quality)) + parts.figures.join("") + parts.adds + parts.target; if (cue) core += " ?"; }
    return prefix ? prefix + " " + core : core;
  }
  // Parser for hand-written template labels in the same Campania syntax (e.g. "b: viio7", "iv\nE: ii", "V4-3", "V7b9", "IVM65").
  const CAMPANIA_RE = /^(?:([A-Ga-g](?:##|#|bb|b)?):\s*)?(?:(It|Ger|Fr)|(bb|b|##|#)?(N|VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(o|ø|\+)?(M)?)(\d+-\d+|\d*b\d+|\d+)?(\([^)]*\))?((?:\/(?:b|#)?(?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i))*)(\s*\?)?$/;
  function parseCampania(text) {
    return String(text).split("\n").map(line => {
      const m = CAMPANIA_RE.exec(line.trim());
      if (!m) return { prefix: null, acc: "", numeral: line.trim(), quality: "", figures: [], inlineFigure: "", adds: "", target: "", special: "", cue: false, unparsed: true };
      const fig = m[7] || ""; let figures = [], inlineFigure = "";
      if (/^\d{2}$/.test(fig) && ["65", "43", "42", "64"].includes(fig)) figures = [fig[0], fig[1]];
      else if (/^\d+$/.test(fig)) figures = [fig];
      else if (fig) inlineFigure = fig;
      return { prefix: m[1] ? m[1] + ":" : null, acc: m[3] || "", numeral: m[4] || "", quality: (m[5] || "") + (m[6] || ""), figures, inlineFigure, adds: m[8] || "", target: m[9] || "", special: m[2] || "", cue: !!m[10], unparsed: false };
    });
  }
  const PRETTY_ACC = { "bb": "𝄫", "b": "♭", "##": "𝄪", "#": "♯", "": "" };
  function prettyAccidentals(s) { return String(s || "").replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/(^|[\/\s(])bb(?=[IViv])/g, "$1𝄫").replace(/(^|[\/\s(:])b(?=[IViv\d])/g, "$1♭"); }
  function prettyPrefix(p) { if (!p) return null; const m = /^([A-Ga-g])(##|#|bb|b)?:$/.exec(p); return m ? m[1] + PRETTY_ACC[m[2] || ""] + ":" : p; }

  // ------------------------------------------------------------------ colouring with the language (MuseScore-ready copy + render copy)
  function colorScoreKey(score, spans, lang, options) {
    const opt = Object.assign({ labels: true, legend: true, cues: true, stripSourceHarmony: true, locale: "en", cad64Bass: true }, options || {});
    const rec = {}; for (const fm of lang.families) rec[fm.id] = fm; rec.unknown = lang.unknown;
    const doc = score.doc.cloneNode(true);
    const origNotes = [...score.doc.getElementsByTagName("note")], cloneNotes = [...doc.getElementsByTagName("note")];
    const cloneOf = new Map(); origNotes.forEach((n, i) => cloneOf.set(n, cloneNotes[i]));
    let nHarmony = 0;
    if (opt.stripSourceHarmony) for (const h of [...doc.getElementsByTagName("harmony")]) { nHarmony += 1; h.parentNode.removeChild(h); }
    // lang.assign: an edited assignment table. A span may carry a reader's correction: familyOverride, seventhOverride
    // (true or false) and textOverride (the label as written, Campania syntax); without them nothing changes.
    const A = lang.assign || DEFAULT_ASSIGN;
    const sev = s => !!s && (s.seventhOverride !== undefined && s.seventhOverride !== null ? !!s.seventhOverride : !!(s.label && isSeventh(s.label)));
    const look = s => { let fam = (s && s.familyOverride) ? s.familyOverride : (s && s.label) ? familyOf(s.label, s.key ? s.key.mode : null, A) : "unknown"; if (!rec[fam]) fam = "unknown"; const r = rec[fam]; return { fam, hex: (sev(s) && A.seventhShade !== false) ? r.seventh : r.triad }; };
    spans.forEach(s => { const l = look(s); s.family = l.fam; s.hex = l.hex; s.seventh = sev(s); });
    const starts = spans.map(s => s.start);
    function spanAt(t) { let lo = 0, hi = starts.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid].le(t)) lo = mid + 1; else hi = mid; } const i = lo - 1; return (i >= 0 && spans[i].start.le(t) && t.lt(spans[i].end)) ? spans[i] : null; }
    const bassEvents = opt.cad64Bass ? bassLineEvents(score.sounding) : new Set();
    const eventOfRecord = new Map(); for (const ev of score.sounding) for (const rr of (ev.records || [])) eventOfRecord.set(rr, ev);
    const perFamily = {}; let nColored = 0, nBass = 0;
    for (const r of score.notation) {
      if (r.isRest) continue;
      const el = cloneOf.get(r.el); if (!el) continue;
      const sp = spanAt(r.onset);
      let hex = sp ? sp.hex : rec.unknown.triad, fam = sp ? sp.family : "unknown";
      if (opt.cad64Bass && A.cad64Bass && rec[A.cad64Bass] && sp && sp.label && !sp.familyOverride && fam === A.cad64 && (fields(sp.label).tags || "").includes("cad64") && sp.key && r.sounding) {
        const dominantPc = mod(sp.key.tonicPc + 7, 12);
        if (r.sounding.pc === dominantPc && bassEvents.has(eventOfRecord.get(r))) { hex = rec[A.cad64Bass].triad; fam = A.cad64Bass; nBass += 1; }
      }
      el.setAttribute("color", hex);
      const nh = child(el, "notehead"); if (nh) nh.setAttribute("color", hex);
      nColored += 1; perFamily[fam] = (perFamily[fam] || 0) + 1;
    }
    const ser = d => { const x = new XMLSerializer().serializeToString(d); return x.startsWith("<?xml") ? x : '<?xml version="1.0" encoding="UTF-8"?>\n' + x; };
    const renderXmlText = ser(doc);
    // Roman numerals under the lowest staff of the last part (Campania font in MuseScore), key name where the key changes
    const partEls = children(doc.documentElement, "part");
    const lastPart = partEls[partEls.length - 1]; const lastInfo = score.parts[score.parts.length - 1];
    const lastMeasures = children(lastPart, "measure");
    let nLabels = 0;
    if (opt.labels && lastMeasures.length) {
      const byMeasure = new Map(); let prevKey = null;
      for (const s of spans) {
        if (s.status === "silent" || s.continuation) { prevKey = s.keyName || prevKey; continue; }
        let mi = 1; for (const m of score.measures) if (m.start.le(s.start)) mi = m.index;
        const changed = !!s.keyName && s.keyName !== prevKey;
        const text = s.textOverride ? (changed && !/^[A-Ga-g](##|#|bb|b)?:/.test(s.textOverride) ? keyPrefix(s.key) + " " : "") + s.textOverride
          : campaniaText(s.label ? labelParts(s.label, s.key ? s.key.mode : null) : null, changed ? keyPrefix(s.key) : null, opt.cues && !!s.cueDegree && !!s.label);
        if (!byMeasure.has(mi)) byMeasure.set(mi, []);
        byMeasure.get(mi).push({ off: s.start.sub(score.measures[mi - 1].start), text, hex: s.hex });
        if (s.keyName) prevKey = s.keyName;
      }
      let divisions = 1;
      const lowStaff = String(lastInfo && lastInfo.staves ? lastInfo.staves : 1);
      lastMeasures.forEach((mx, idx) => {
        const att = child(mx, "attributes"); if (att && childText(att, "divisions")) divisions = parseInt(childText(att, "divisions"), 10);
        const items = byMeasure.get(idx + 1); if (!items) return;
        // D037: anchor each label on the note that starts at its time, preferably in the lowest staff, and name that note's
        // voice. A label written at the bar start with an offset is attached by MuseScore to the next chord of voice 1, so
        // it drifts right when the bass sits in another voice (Mozart K. 576/II, bar 2).
        const starts = []; let pos = 0, lastOn = 0;
        for (const c of [...mx.children]) {
          if (c.localName === "backup") pos -= parseInt(childText(c, "duration") || "0", 10);
          else if (c.localName === "forward") pos += parseInt(childText(c, "duration") || "0", 10);
          else if (c.localName === "note") {
            const isChord = !!child(c, "chord"), isGrace = !!child(c, "grace");
            const on = isChord ? lastOn : pos;
            if (!isChord && !isGrace) { lastOn = pos; pos += parseInt(childText(c, "duration") || "0", 10); }
            if (!isChord && !isGrace) starts.push({ el: c, on, staff: childText(c, "staff") || "1", voice: childText(c, "voice"), rest: !!child(c, "rest") });
          }
        }
        let insertAt = 0; [...mx.children].forEach((c, i) => { if ((c.localName === "attributes" || c.localName === "print" || c.localName === "barline") && c.getAttribute("location") !== "right") insertAt = i + 1; });
        items.sort((a, b) => a.off.cmp(b.off));
        for (const it of items) {
          const d = doc.createElement("direction"); d.setAttribute("placement", "below");
          const dt = doc.createElement("direction-type"); const w = doc.createElement("words");
          w.setAttribute("font-family", "Campania"); w.setAttribute("font-size", "10.5"); w.setAttribute("color", it.hex); w.textContent = it.text;
          dt.appendChild(w); d.appendChild(dt);
          const offDiv = Math.round(it.off.mul(divisions).num());
          const here = starts.filter(s => s.on === offDiv);
          const anchor = here.find(s => s.staff === lowStaff && !s.rest) || here.find(s => s.staff === lowStaff) || here.find(s => !s.rest) || null;
          if (anchor) {
            if (anchor.voice) { const v = doc.createElement("voice"); v.textContent = anchor.voice; d.appendChild(v); }
            const st = doc.createElement("staff"); st.textContent = anchor.staff; d.appendChild(st);
            mx.insertBefore(d, anchor.el);
          } else {
            if (it.off.gt(F0)) { const o = doc.createElement("offset"); o.textContent = String(offDiv); d.appendChild(o); }
            const st = doc.createElement("staff"); st.textContent = lowStaff; d.appendChild(st);
            mx.insertBefore(d, mx.children[insertAt] || null); insertAt += 1;
          }
          nLabels += 1;
        }
      });
    }
    if (opt.legend && partEls.length) {
      const loc = opt.locale === "zh" ? "zh" : "en";
      const firstM = children(partEls[0], "measure")[0];
      const lines = [];
      for (const fm of lang.families) if (perFamily[fm.id]) lines.push({ hex: fm.triad, text: (opt.legendName === "term" ? fm.term[loc].charAt(0).toUpperCase() + fm.term[loc].slice(1) : fm.plain[loc] + " · " + fm.term[loc]) + " (" + fm.numerals + ")" + (fm.short ? (loc === "zh" ? "：" : ": ") + fm.short[loc] : ""), bold: true });
      lines.push({ hex: "#333333", text: loc === "zh" ? ((lang.rules || []).find(r => r.id === "seventh") || { zh: "同一颜色更深，表示七和弦。" }).zh : "Deeper shade of a color = seventh chord. Labels: Roman numerals in the current key; a key name (c#:, E:) marks a key change.", bold: false });
      if (firstM) {
        let insertAt = 0; [...firstM.children].forEach((c, i) => { if (c.localName === "attributes" || c.localName === "print") insertAt = i + 1; });
        for (const ln of lines.reverse()) {    // MuseScore stacks later texts above earlier ones: insert the bottom line first
          const d = doc.createElement("direction"); d.setAttribute("placement", "above");
          const dt = doc.createElement("direction-type"); const w = doc.createElement("words");
          w.setAttribute("font-size", "7"); if (ln.bold) w.setAttribute("font-weight", "bold"); w.setAttribute("color", ln.hex); w.textContent = ln.text;
          dt.appendChild(w); d.appendChild(dt); const st = doc.createElement("staff"); st.textContent = "1"; d.appendChild(st);
          firstM.insertBefore(d, firstM.children[insertAt] || null); insertAt += 1;
        }
      }
    }
    return { xmlText: ser(doc), renderXmlText, report: { nColored, nLabels, nCad64Bass: nBass, families: perFamily, sourceHarmonyRemoved: nHarmony, language: lang.version } };
  }
  function durationAgreement(aSpans, bSpans, end, keyOf) {
    // aSpans/bSpans: [{start, end, value}] with Frac times; duration share where both values are equal and not null
    const pts = new Map(); for (const s of aSpans.concat(bSpans)) { pts.set(s.start.str(), s.start); pts.set(s.end.str(), s.end); } pts.set("0/1", F0); pts.set(end.str(), end);
    const times = [...pts.values()].sort((x, y) => x.cmp(y));
    const at = (spans, t) => { for (const s of spans) if (s.start.le(t) && t.lt(s.end)) return s; return null; };
    let match = F0, total = F0; const byValue = {};
    for (let i = 0; i + 1 < times.length; i++) {
      const a = times[i], b = times[i + 1]; if (b.le(a) || a.ge(end)) continue;
      const d = Frac.min(b, end).sub(a); total = total.add(d);
      const x = at(aSpans, a), y = at(bSpans, a);
      if (x && y && x.value !== null && x.value === y.value) { match = match.add(d); byValue[x.value] = (byValue[x.value] || F0).add(d); }
    }
    return { agreement: total.gt(F0) ? match.num() / total.num() : null, match: match.num(), total: total.num() };
  }

  async function unpackMxl(arrayBuffer, JSZipLib) {
    const zip = await JSZipLib.loadAsync(arrayBuffer);
    let member = null;
    const container = zip.file("META-INF/container.xml");
    if (container) { const c = new DOMParser().parseFromString(await container.async("string"), "application/xml"); const rf = c.getElementsByTagName("rootfile")[0]; if (rf && rf.getAttribute("full-path")) member = rf.getAttribute("full-path"); }
    if (!member) { const cands = Object.keys(zip.files).filter(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith("META-INF")); if (cands.length !== 1) throw new Error("Cannot identify the score inside the .mxl container"); member = cands[0]; }
    return { xmlText: await zip.file(member).async("string"), member };
  }
  global.ColorKey = { Frac, readScore, unpackMxl, keyFromName, applyKeyOverrides, ProgressionModel, decodeProgression, BackoffPredictor, cueNeeded, parseInput, makeInput, theoreticalBassPc, analyze, colorScore, verifyInvariants, labelToRnText, functionCategory, hexFor, spanText, beatGridBoundaries, segmentsFromBoundaries, keyAt,
                      DEGREE_PALETTE, FUNCTION_PALETTE, UNLABELLED, FUNCTION_RULES, VIEWS, DEFAULT_CONFIG,
                      familyOf, DEFAULT_ASSIGN, isSeventh, labelParts, keyPrefix, campaniaText, parseCampania, prettyAccidentals, prettyPrefix, colorScoreKey, durationAgreement, signatureStartKeys, fields,
                      PROFILES, DEPLOYMENT_BASS_PROFILE, bassLineEvents, templatesFrom, profileTemplates, channelScores, dictionaryFrameEvidence, BassProfileIndex,
                      LANGUAGE_VERSION: "0.2", ENGINE_VERSION: "3.0.0" };
})(typeof window !== "undefined" ? window : globalThis);
