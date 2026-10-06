/* Color Key: page logic. Everything runs in the browser; a dropped score is never sent anywhere. */
(function () {
  "use strict";
  const CK = window.ColorKey, OV = window.ColorKeyOverlay, $ = id => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  const Studio = query.get("studio") === "0" ? null : (window.CKStudio || null);       // the "Make it yours" layer, when the build published it (studio.js)
  const state = { lang: null, base: null, dict: null, prog: null, examples: [], about: {}, name: "score", meta: {}, piece: null, score: null, result: null, report: null, pitch: null,
                  readings: null, walk: {}, view: "harmony", pinned: null, osmd: null, xmlShown: null, same: null, token: 0, job: 0, ready: false, opened: false };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const pretty = s => String(s || "").replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/(^|[^A-Za-z])bb(?=[IViv\d])/g, "$1𝄫").replace(/(^|[^A-Za-z])b(?=[IViv\d])/g, "$1♭");
  const keyName = n => { const m = /^([A-G])(##|#|bb|b)? (major|minor)$/.exec(n || ""); return m ? m[1] + ({ "#": "♯", "b": "♭", "##": "𝄪", "bb": "𝄫" }[m[2]] || "") + " " + m[3] : (n || ""); };
  const count = n => n.toLocaleString("en-US");
  // a chord's name as the score prints it: accidentals as signs, the diminished sign as a small circle
  const numeralOf = (label, mode) => { const p = label ? CK.labelParts(label, mode) : null; return p ? pretty(CK.campaniaText(Object.assign({}, p, { quality: (p.quality || "").replace("o", "°") }))) : "?"; };
  const written = t => pretty(t).replace(/([iv])o(?![a-z])/g, "$1°");       // a chord name the visitor chose or wrote (span.textOverride), printed the same way
  const pause = () => new Promise(r => setTimeout(r, 30));
  function status(text, kind) { const el = $("status"); el.textContent = text || ""; el.title = text || ""; el.className = "status" + (kind === "error" ? " error" : ""); }
  function dropNote(text) { $("dropNote").textContent = text || ""; }
  const media = q => (window.matchMedia ? window.matchMedia(q) : { matches: false });
  const watch = (mq, fn) => { if (mq.addEventListener) mq.addEventListener("change", fn); else if (mq.addListener) mq.addListener(fn); };       // older browsers know only addListener
  const still = media("(prefers-reduced-motion: reduce)"), smooth = () => (still.matches ? "auto" : "smooth");
  const phone = () => media("(max-width: 560px)").matches, touchOnly = () => media("(hover: none)").matches;

  // ------------------------------------------------------------------ hooks: another script (studio.js) listens here, so this file need not change for it
  //   "analysis"  { spans, score, piece }         after each analysis and before the drawing. The call is synchronous: a listener may lay corrections on the spans
  //                                               (familyOverride, seventhOverride, textOverride, continuation, and a mark in span.studio).
  //   "why"       { i, span, box, bar, piece }    the card of one chord is in the page and not yet placed: a listener may add to it.
  //   "family"    { id, cap }                     a family was pinned on the wheel, or the wheel was drawn again after a change while one is pinned:
  //                                               cap (#harmonyCap) is empty and sits under that family's row, ready to be filled.
  const hooks = {};
  const on = (name, fn) => { (hooks[name] = hooks[name] || []).push(fn); };
  const emit = (name, detail) => { for (const fn of hooks[name] || []) { try { fn(detail); } catch (e) { console.error(e); } } };
  // the second reading (engine/second.js) is used when it is on the page and its run allows it (data/about.json, "second")
  const secondOn = () => !!(window.CKSecond && state.about.second && state.about.second.show && query.get("second") !== "0");
  // Switches for checking, none of them stored: ?second=0 and ?studio=0 run the page without that part; ?motion=off, ?glass=off, ?theme=dark|light; ?p=x,y[,phase] holds the pointer for a picture.

  // ------------------------------------------------------------------ reading
  function measureIndexAt(score, t) { let lo = 0, hi = score.measures.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (score.measures[mid].start.le(t)) lo = mid + 1; else hi = mid; } return Math.max(0, lo - 1); }
  function barOf(score, t) { const m = score.measures[measureIndexAt(score, t)]; return m ? (m.printedNumber || String(m.index)) : "?"; }
  function titleOf(xml, fallback) {
    try {
      const d = new DOMParser().parseFromString(xml, "application/xml");
      const q = sel => { const e = d.querySelector(sel); return e && e.textContent.trim() ? e.textContent.trim() : null; };
      return { title: q("work > work-title") || q("movement-title") || fallback, composer: q('identification > creator[type="composer"]') || "" };
    } catch (e) { return { title: fallback, composer: "" }; }
  }
  function example(id) { for (const c of $("tries").querySelectorAll("[data-ex]")) { if (c.dataset.ex === id) c.setAttribute("aria-current", "true"); else c.removeAttribute("aria-current"); } }
  // after the visitor opened something: bring its place into the window when it is not there (a phone, or a file opened from further down the page)
  function reveal(el) { const r = el.getBoundingClientRect(); if (r.top < 0 || r.top > window.innerHeight * 0.62) window.scrollTo({ top: window.scrollY + r.top - 72, behavior: smooth() }); }
  function working(text, quiet) { status(text); if (!quiet) dropNote(text); }        // said in the bar above the score and, for a visitor's own file, by the drop zone too
  function explain(err) {     // a failure in plain words; what the library said goes to the console only
    const m = String((err && err.message) || "");
    if (err && err.plain) return err.plain;
    if (/not well-formed XML/.test(m)) return "This file is not MusicXML: it could not be read as XML.";
    if (/score-partwise/.test(m)) return "This file is XML, but not a MusicXML score the page can read. A notation program can save it again as MusicXML.";
    if (/No <part>/.test(m)) return "This MusicXML file has no parts in it.";
    return "This file could not be read as MusicXML.";
  }
  function failed(err, job) {       // nothing on the page has changed: the piece that was open is still whole. The message stands by the drop zone, where another file can be chosen.
    console.error(err); if (job !== state.job) return;
    const msg = explain(err);
    if (state.score) status(""); else status(msg, "error");
    dropNote(msg); reveal($("drop"));
  }
  // A PDF or a picture of printed music is handed to the reader (window.ColorKeyOMR, loaded separately) when it is there. MusicXML is read here.
  const isPrinted = f => /\.(pdf|png|jpe?g)$/i.test(f.name || "") || /^(application\/pdf|image\/(png|jpeg))$/.test(f.type || "");
  const stopReader = () => { if (window.ColorKeyOMR && window.ColorKeyOMR.cancel) { try { window.ColorKeyOMR.cancel(); } catch (e) { console.error(e); } } };
  function openAny(file) {
    dropNote("");
    if (!isPrinted(file)) return openFile(file);
    if (window.ColorKeyOMR && typeof window.ColorKeyOMR.open === "function") { state.job += 1; closeWhy(); example(null); state.opened = false; return window.ColorKeyOMR.open(file); }
    dropNote("This page reads MusicXML only: a .musicxml, .xml or .mxl file."); reveal($("drop"));
  }
  async function openFile(file) {
    const job = ++state.job; closeWhy();
    try {
      working("Reading the file…"); await pause();
      let xml;
      if (/\.mxl$/i.test(file.name)) {
        try { xml = (await CK.unpackMxl(await file.arrayBuffer(), JSZip)).xmlText; }
        catch (err) { console.error(err); throw Object.assign(new Error("mxl"), { plain: "This .mxl file is damaged or holds no score. Saving it again, or using the plain .musicxml file, should work." }); }
      } else xml = await file.text();
      const stem = file.name.replace(/\.(musicxml|xml|mxl)$/i, "");
      if (await run(job, stem, xml, titleOf(xml, stem))) { example(null); state.opened = false; dropNote(""); reveal($("result")); }
    } catch (err) { failed(err, job); }
  }
  async function openExample(id, opening) {
    const ex = state.examples.find(e => e.id === id); if (!ex) return;
    const job = ++state.job; closeWhy();
    try {
      if (!state.score) $("result").hidden = false;       // nothing is open yet: the bar shows the progress
      working("Opening " + ex.title + "…", !!opening); await pause();
      const r = await fetch(ex.file); if (!r.ok) throw new Error("example not found");
      const buf = await r.arrayBuffer();
      const xml = /\.mxl$/i.test(ex.file) ? (await CK.unpackMxl(buf, JSZip)).xmlText : new TextDecoder().decode(buf);
      if (await run(job, ex.id, xml, { title: ex.title, composer: ex.composer }, !!opening)) { example(id); state.opened = !!opening; if (!opening) { dropNote(""); reveal($("result")); } }
    } catch (err) { failed(Object.assign(err || {}, { plain: "The example could not be opened." }), job); }
  }
  // Read and analyze first. The page changes only when both have worked, so a file that fails leaves the piece on screen as it was: its title, its notes, its download.
  async function run(job, name, xml, meta, quiet) {
    working("Finding the key and reading the chords…", quiet); await pause();
    if (job !== state.job) return false;
    const score = CK.readScore(xml);
    if (!score.notation.some(r => !r.isRest)) throw Object.assign(new Error("no notes"), { plain: "No notes were found in this file." });
    const result = CK.analyze(score, state.dict, { backoff: true, keyStartPrior: true, confidentFrequency: 0.7,
      progression: { model: state.prog.model, weight: state.prog.weight, kappa: state.prog.kappa, prior: state.prog.prior } });
    stopReader(); $("omr").hidden = true; $("result").hidden = false;
    state.name = name; state.meta = meta; state.same = null; state.pinned = null; state.readings = null; state.score = score; state.result = result;
    $("piece").textContent = meta.title || name; $("by").textContent = meta.composer || "";
    let key = name; if (Studio && Studio.pieceKey) { try { key = Studio.pieceKey(state.score); } catch (e) { console.error(e); } }
    state.piece = { key, title: meta.title || name };
    emit("analysis", { spans: state.result.spans, score: state.score, piece: state.piece });
    await draw();
    return true;
  }

  // ------------------------------------------------------------------ coloring
  const serialize = d => { const x = new XMLSerializer().serializeToString(d); return x.startsWith("<?xml") ? x : '<?xml version="1.0" encoding="UTF-8"?>\n' + x; };
  function harmony(forFile) {
    return CK.colorScoreKey(state.score, state.result.spans, state.lang, forFile ? { locale: "en", cues: true, legendName: "term" } : { locale: "en", cues: false, labels: false, legend: false });
  }
  function byPitch() {      // the first idea: one color per note name, the same in every key
    const score = state.score, doc = score.doc.cloneNode(true);
    const orig = [...score.doc.getElementsByTagName("note")], cl = [...doc.getElementsByTagName("note")], cloneOf = new Map();
    orig.forEach((n, i) => cloneOf.set(n, cl[i]));
    for (const h of [...doc.getElementsByTagName("harmony")]) h.parentNode.removeChild(h);
    const counts = new Array(12).fill(0); let n = 0;
    for (const r of score.notation) {
      if (r.isRest || !r.sounding) continue;
      const el = cloneOf.get(r.el); if (!el) continue;
      const hex = state.lang.pitch.colors[r.sounding.pc];
      el.setAttribute("color", hex);
      for (const c of el.children) if (c.localName === "notehead") c.setAttribute("color", hex);
      counts[r.sounding.pc] += 1; n += 1;
    }
    return { xml: serialize(doc), counts, n };
  }
  function labels() {       // the numerals under the staff. A chord the visitor corrected may carry its own text, or be joined to the chord before it.
    const score = state.score, out = []; let prevKey = null;
    state.result.spans.forEach((s, i) => {
      if (s.status === "silent" || s.continuation) return;
      const mi = measureIndexAt(score, s.start), q = s.start.sub(score.measures[mi].start).num();
      const changed = !!s.key && s.key.name !== prevKey;
      let lines = null;
      if (s.textOverride) { try { lines = CK.parseCampania(s.textOverride); if (changed && lines.length && !lines[0].prefix) lines[0].prefix = CK.keyPrefix(s.key); } catch (e) { lines = null; } }
      if (!lines || !lines.length) {
        const parts = s.label ? CK.labelParts(s.label, s.key ? s.key.mode : null) : null;
        const base = { prefix: changed ? CK.keyPrefix(s.key) : null, inlineFigure: "", cue: !!(s.cueDegree && s.label && !s.familyOverride) };
        lines = [parts ? Object.assign(base, parts) : Object.assign(base, { acc: "", numeral: "?", quality: "", figures: [], adds: "", target: "", special: "" })];
      }
      out.push({ id: i, measureIndex: mi, q, lines, color: s.hex || state.lang.unknown.triad });
      if (s.key) prevKey = s.key.name;
    });
    return out;
  }
  const hexOf = (id, seventh) => { const f = state.lang.families.find(x => x.id === id) || state.lang.unknown; return seventh ? f.seventh : f.triad; };
  const hexOfKey = k => /^p\d+$/.test(k) ? state.lang.pitch.colors[+k.slice(1)] : hexOf(k, false);        // a legend entry: a family, or a note name ("p7")
  function homeHex() {      // the color of the family that fills most of the piece
    const dur = {}; for (const s of state.result.spans) if (s.status !== "silent" && s.family) dur[s.family] = (dur[s.family] || 0) + s.end.num() - s.start.num();
    const top = Object.keys(dur).sort((a, b) => dur[b] - dur[a])[0];
    return (state.lang.families.find(f => f.id === top) || state.lang.families[0]).triad;
  }

  // ------------------------------------------------------------------ one role at a time: the rest of the score steps back
  function soloRules() {    // once: one rule for every family and note name
    const ids = state.lang.families.map(f => f.id).concat(["unknown"], state.lang.pitch.names.map((n, i) => "p" + i)), st = document.createElement("style");
    st.textContent = ids.map(k => `#score[data-solo="${k}"] [data-fam]:not([data-fam="${k}"])`).join(",") + "{opacity:.14}"; document.head.appendChild(st);
  }
  function tagFamilies() {  // after every drawing: what belongs to which family (or note name), told by its color
    const by = new Map();
    if (state.view === "harmony") { for (const f of state.lang.families) { by.set(f.triad.toUpperCase(), f.id); by.set(f.seventh.toUpperCase(), f.id); } by.set(state.lang.unknown.triad.toUpperCase(), "unknown"); }
    else state.lang.pitch.colors.forEach((c, i) => by.set(c.toUpperCase(), "p" + i));
    for (const el of $("score").querySelectorAll("svg [fill], svg [stroke]")) {
      if (el.localName === "tspan") continue;
      const k = by.get((el.getAttribute("fill") || "").toUpperCase()) || by.get((el.getAttribute("stroke") || "").toUpperCase());
      if (k) el.setAttribute("data-fam", k);
    }
  }
  function solo(k) { const host = $("score"); if (k) host.dataset.solo = k; else delete host.dataset.solo; }
  function chosen() {       // the far field of the backdrop: the chord whose card is open, or the pinned legend entry
    if (!state.lang) return;
    const open = document.querySelector(".why"); Field.choose(open ? open.dataset.hex : state.pinned ? hexOfKey(state.pinned) : null);
  }
  function numeralButtons() {      // the numerals are controls. The score is one tab stop: the arrow keys, Home and End move from chord to chord.
    const all = [...$("score").querySelectorAll("text[data-i]")];
    all.forEach((t, n) => {
      const s = state.result.spans[+t.getAttribute("data-i")]; if (!s) return;
      const fam = state.lang.families.find(f => f.id === s.family) || state.lang.unknown;
      const name = s.textOverride ? written(s.textOverride) : s.label ? numeralOf(s.label, s.key ? s.key.mode : null) : "";
      t.setAttribute("tabindex", n ? "-1" : "0"); t.setAttribute("role", "button"); t.setAttribute("aria-haspopup", "dialog");
      t.setAttribute("aria-label", name ? name + ", " + fam.plain.en + ": the " + (state.readings ? "readings" : "reading") + " of this chord"
        : "No reading: " + (state.readings ? "what the rule says about this chord" : "why this chord has none"));
    });
    $("sheet").setAttribute("role", "group");
    $("sheet").setAttribute("aria-label", all.length ? "The colored score. The arrow keys move from chord to chord; Enter opens a chord's " + (state.readings ? "two readings." : "reading.") : "The colored score.");
  }
  function rove(el) { for (const t of $("score").querySelectorAll('text[data-i][tabindex="0"]')) if (t !== el) t.setAttribute("tabindex", "-1"); el.setAttribute("tabindex", "0"); }
  function step(el, to) {   // from one numeral to the next, the one before, the first or the last
    const all = [...$("score").querySelectorAll("text[data-i]")], at = all.indexOf(el);
    const next = to === "home" ? all[0] : to === "end" ? all[all.length - 1] : all[at + to];
    if (next && next !== el) { rove(next); next.focus(); }
  }
  function nearNumeral(x, y, reach) {       // a finger rarely lands on a glyph 12 px high: the numeral nearest to the touch, within reach
    let best = null, bd = reach;
    for (const t of $("score").querySelectorAll("text[data-i]")) {
      const r = t.getBoundingClientRect(), dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom), d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function pickAt(el, keys) {     // the chosen numeral, boxed in ink (a stronger ring when it was reached by keyboard)
    unpick();
    const sheet = $("sheet"), ar = el.getBoundingClientRect(), sr = sheet.getBoundingClientRect(), pick = document.createElement("div"); pick.className = "pick" + (keys ? " kb" : ""); sheet.appendChild(pick);
    const w = Math.max(ar.width + 8, 26);       // a single letter still gets a box, not a sliver
    pick.style.left = (ar.left + ar.width / 2 - w / 2 - sr.left + sheet.scrollLeft) + "px"; pick.style.top = (ar.top - sr.top + sheet.scrollTop - 3) + "px";
    pick.style.width = w + "px"; pick.style.height = (ar.height + 6) + "px";
  }
  function unpick() { const p = document.querySelector(".pick"); if (p) p.remove(); }

  // ------------------------------------------------------------------ drawing
  function clearHere() { const el = document.querySelector(".here"); if (el) el.remove(); }
  function goToBar(mi) {    // scroll to a bar and show it for a moment
    clearHere();
    try {
      const osmd = state.osmd, row = osmd.GraphicSheet.MeasureList[mi].filter(Boolean), unit = 10 * (osmd.zoom || osmd.Zoom || 1);
      const a = row[0].PositionAndShape, z = row[row.length - 1].PositionAndShape, sheet = $("sheet");
      const sr = sheet.getBoundingClientRect(), vr = $("score").querySelector("svg").getBoundingClientRect();
      const el = document.createElement("div"); el.className = "here";
      const top = vr.top - sr.top + sheet.scrollTop + (a.AbsolutePosition.y - 1.5) * unit;
      el.style.left = (vr.left - sr.left + sheet.scrollLeft + a.AbsolutePosition.x * unit) + "px"; el.style.top = top + "px";
      el.style.width = (a.Size.width * unit) + "px"; el.style.height = ((z.AbsolutePosition.y - a.AbsolutePosition.y + 7) * unit) + "px";
      sheet.appendChild(el);
      window.scrollTo({ top: window.scrollY + sr.top + top - window.innerHeight * 0.3, behavior: still.matches ? "auto" : "smooth" });
      setTimeout(() => { if (el.parentNode) el.remove(); }, 2600);
    } catch (e) { $("sheet").scrollIntoView(); }
  }
  // The names under the last system are drawn after the engraving, which keeps no room for them: the drawing is made as tall as what was added to it.
  function roomBelow(host) {
    try {
      const svg = host.querySelector("svg"), g = svg ? svg.querySelector(".ck-overlay") : null; if (!g || !g.childNodes.length) return;
      const vb = svg.viewBox.baseVal, box = g.getBBox(), h = svg.height.baseVal.value, need = box.y + box.height + 6 - (vb.y + vb.height);       // in the drawing's own units
      if (!(need > 0) || !(vb.height > 0)) return;
      const to = vb.height + need;
      svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.width + " " + to); svg.setAttribute("height", String(h * to / (to - need)));
    } catch (e) { console.error(e); }
  }
  let lastW = 0;            // the width the score was last drawn for: a resize draws it again only when this has changed
  async function draw() {
    const token = ++state.token, host = $("score");
    closeWhy(); clearHere(); status("Drawing the score…"); await pause();
    const harm = state.view === "harmony";
    const colored = harm ? harmony(false) : null, pitch = harm ? null : byPitch();
    const xml = harm ? colored.renderXmlText : pitch.xml;
    state.readings = null; state.walk = {};
    if (harm && secondOn()) {       // the second reading, by rule: read after any correction is on the spans; it changes nothing in them
      try { state.readings = window.CKSecond.read(state.score, state.result, state.lang, { collection: !!state.about.second.collection }); } catch (e) { console.error(e); state.readings = null; }
    }
    if (!state.osmd) {
      state.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(host, { autoResize: false, backend: "svg", drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false,
        drawCredits: false, drawPartNames: false, drawPartAbbreviations: false, drawMeasureNumbers: true, coloringEnabled: true, colorStemsLikeNoteheads: true, pageFormat: "Endless", drawMetronomeMarks: false });
    }
    const osmd = state.osmd;
    await osmd.load(xml);
    if (token !== state.token) return;
    const w = host.clientWidth || 900, R = osmd.EngravingRules; lastW = host.clientWidth;
    osmd.Zoom = w < 520 ? 0.6 : w < 800 ? 0.78 : 0.95;
    R.PageTopMargin = 1; R.PageBottomMargin = 1;      // the sheet has its own padding: the first system starts near its top, so more of it shows when the page opens
    if (!state.rules0) state.rules0 = { staves: R.MinSkyBottomDistBetweenStaves, between: R.BetweenStaffDistance, staff: R.StaffDistance };
    R.MinSkyBottomDistBetweenStaves = state.rules0.staves; R.BetweenStaffDistance = state.rules0.between; R.StaffDistance = state.rules0.staff;
    R.MinSkyBottomDistBetweenSystems = harm ? 11.5 : 5; R.MinimumDistanceBetweenSystems = harm ? 6 : 4;
    osmd.render();
    const lab = harm ? labels() : [];
    const over = () => OV.drawOverlay(osmd, host, lab, [], { size: w < 520 ? 21 : 18, font: "Georgia, 'Times New Roman', serif", noteFont: "system-ui, sans-serif", noteColor: "#555555", cueColor: "#555555" });
    let res = over(), staves = OV.staffOverlaps(osmd);
    for (let pass = 0; pass < 2 && staves.overlaps; pass++) {       // staves that meet get more room
      const deep = Math.max(1, ...staves.where.map(x => x.depth));
      R.MinSkyBottomDistBetweenStaves = (R.MinSkyBottomDistBetweenStaves || 1) + deep; R.BetweenStaffDistance += deep; R.StaffDistance += deep; R.MinSkyBottomDistBetweenSystems += deep;
      osmd.render(); res = over(); staves = OV.staffOverlaps(osmd);
    }
    for (let pass = 0; pass < 2 && res && res.layout && res.layout.need > 0; pass++) {   // labels that reach the next line get more room
      R.MinSkyBottomDistBetweenSystems += Math.ceil(res.layout.need / 10) + 0.5;
      osmd.render(); res = over(); staves = OV.staffOverlaps(osmd);
    }
    roomBelow(host);
    state.xmlShown = xml; state.layout = res ? res.layout : null; state.staves = staves; state.report = harm ? colored.report : null; state.pitch = pitch;
    tagFamilies(); numeralButtons(); solo(state.pinned);
    summary();
    $("save").disabled = false; status("");
    const both = !!state.readings, mine = !!Studio, act = touchOnly() ? "Tap" : "Click";
    $("hint").textContent = !harm ? "Pitch Color: every note name has its own color, the same in every key."
      : act + (both ? " a Roman numeral to see both readings of that chord" : " a Roman numeral to see why that chord was read that way") + (mine ? ", or to change it." : ".")
        + (state.opened && state.name === "chopin" ? " This is Chopin's Prelude in C minor, already colored." : "");
    setTimeout(() => {      // read the colored score back and compare it with the original
      if (token !== state.token) return;
      try { const r = CK.verifyInvariants(state.score, CK.readScore(xml)); state.same = !!(r.notationIdentical && r.soundingIdentical && r.measuresIdentical && r.scoreEndIdentical); } catch (e) { state.same = false; }
      summary();
    }, 60);
  }
  // the bar above the sheet: keys, facts, the two readings compared, legend
  function summary() {
    const sc = state.score, res = state.result, harm = state.view === "harmony", report = state.report, pitch = state.pitch;
    if (!sc || !res || (harm ? !report : !pitch)) return;
    const keys = res.keys.filter(k => k.end.gt(k.start));
    $("keys").innerHTML = !harm ? "" : keys.length === 1 ? "Key: <b>" + esc(keyName(keys[0].key.name)) + "</b>"       // later keys are links to their bar
      : "Keys: " + keys.slice(0, 14).map((k, i) => i
          ? `<button class="link" type="button" data-bar="${measureIndexAt(sc, k.start)}">${esc(keyName(k.key.name))}</button> <span>(bar ${esc(barOf(sc, k.start))})</span>`
          : "<b>" + esc(keyName(k.key.name)) + "</b>").join(" → ") + (keys.length > 14 ? " …" : "");
    $("keys").className = "keys" + (harm && keys.length > 1 ? " many" : "");
    const spans = res.spans.filter(s => s.status !== "silent"), chords = spans.filter(s => !s.continuation), total = sc.scoreEnd.num() || 1;
    const mine = s => !!(s.studio || s.familyOverride || s.textOverride || s.continuation);        // a chord the visitor corrected or taught is not counted as unsure
    const unsure = spans.filter(s => !mine(s) && (!s.label || s.cueDegree)).reduce((a, s) => a + s.end.num() - s.start.num(), 0) / total;
    const pitched = sc.notation.filter(r => !r.isRest).length, colored = harm ? report.nColored : pitch.n;
    const facts = [count(colored) + (colored === pitched ? " notes colored" : " of " + count(pitched) + " notes colored")];
    if (state.same !== null) facts.push(state.same ? "notes unchanged ✓" : '<span class="warn">the colored score differs from the original; do not use it</span>');
    if (harm) {
      facts.push(count(chords.length) + " chords");
      facts.push(Math.round(100 * unsure) + "% marked unsure" + (unsure > 0.5 ? " <b>(this music may lie outside what the page knows)</b>" : ""));
      const changed = chords.filter(s => s.studio).length;
      if (changed) facts.push(count(changed) + (changed === 1 ? " chord follows" : " chords follow") + " your changes");
      if (state.readings) {         // the second reading in one phrase; "different on 3" walks through those chords
        let sum = null; try { sum = window.CKSecond.summary(state.readings.filter((r, i) => !(res.spans[i] && res.spans[i].continuation))); } catch (e) { console.error(e); }
        if (sum && sum.text) {
          state.differAt = sum.differAt || []; state.barsAt = sum.barsAt || [];
          let own = false; try { own = !window.CKSecond.isPublishedTable(state.lang); } catch (e) { /* the published table */ }
          facts.push('<span class="byrule"><i class="pairmark" aria-hidden="true"></i>' + esc(sum.text)
            .replace(/different on (\d+)/, '<button class="link" id="differNext" type="button">different on $1</button>')
            .replace(/(\d+ bars? fits? one symmetrical scale)/, '<button class="link" id="barsNext" type="button">$1</button>') + (own ? ", with your color table" : "") + "</span>");
        }
      }
    }
    const lay = state.layout, touching = lay && !lay.error ? lay.labelsTouching + lay.labelsOverlapping + (state.staves ? state.staves.overlaps : 0) : 0;
    if (touching) facts.push(touching + " place" + (touching === 1 ? "" : "s") + " where print overlaps");
    $("facts").innerHTML = facts.map(f => "<span>" + f + "</span>").join("");
    legend();
    Field.fromPiece(homeHex());       // the backdrop takes the piece's home color
  }
  function legend() {       // one entry per family present (or per note name): point at one to see that role alone, click to keep it
    const harm = state.view === "harmony";
    const chip = (k, hex, name) => `<li><button class="chip" type="button" data-k="${esc(k)}" data-hex="${esc(hex)}" aria-pressed="${state.pinned === k}"><span class="dot" style="background:${esc(hex)}"></span>${esc(name)}</button></li>`;
    if (harm && state.report) $("legend").innerHTML = state.lang.families.filter(f => state.report.families[f.id]).map(f => chip(f.id, f.triad, f.plain.en)).join("");
    else if (!harm && state.pitch) $("legend").innerHTML = state.lang.pitch.names.map((n, i) => state.pitch.counts[i] ? chip("p" + i, state.lang.pitch.colors[i], n) : "").join("");
  }
  function walk(name) {     // "different on 3": each click goes to the next of those chords and opens its card
    const list = name === "bars" ? state.barsAt : state.differAt; if (!list || !list.length) return;
    const at = state.walk[name] = ((state.walk[name] === undefined ? -1 : state.walk[name]) + 1) % list.length;
    const el = $("score").querySelector('text[data-i="' + list[at] + '"]'); if (!el) return;
    const sheet = $("sheet"), sr = sheet.getBoundingClientRect(), r0 = el.getBoundingClientRect();
    if (r0.left < sr.left || r0.right > sr.right) sheet.scrollLeft += r0.left - sr.left - sr.width / 2;
    // where the numeral should come to rest: high enough that the whole card fits under it, low enough that its chord stays in view
    why(list[at], el, false, phone() ? window.innerHeight * 0.16 : Math.max(200, Math.min(window.innerHeight * 0.4, window.innerHeight - 560)));
  }

  // ------------------------------------------------------------------ why this chord: the two readings side by side
  function closeWhy() {
    const el = document.querySelector(".why"); let back = null;
    if (el) { if (el.contains(document.activeElement)) back = $("score").querySelector('text[data-i="' + el.dataset.i + '"]'); el.remove(); }
    unpick(); if (back) back.focus({ preventScroll: true });
    chosen();
  }
  function describeNotes(input) {
    try {
      const p = CK.parseInput(input), f = x => ({ "-2": "𝄫", "-1": "♭", "0": "", "1": "♯", "2": "𝄪" }[String(x[1])] || "") + x[0];
      return "scale degrees " + p.feats.map(f).join(" ") + (p.bass ? ", with " + f(p.bass) + " in the bass" : "");
    } catch (e) { return ""; }
  }
  function why(i, el, byKeys, aimTop) {      // aimTop: where in the window the numeral should come to rest (the walk through differing chords asks for it)
    closeWhy();
    const res = state.result, s = res ? res.spans[i] : null; if (!s || !el) return;
    const mode = s.key ? s.key.mode : null, text = l => numeralOf(l, mode), num = t => `<span class="num">${esc(t)}</span>`;
    const fam = state.lang.families.find(f => f.id === s.family) || state.lang.unknown, ev = s.evidence || {}, hex = s.hex || fam.triad;
    const rd = state.readings ? state.readings[i] : null, rule = rd && rd.relation && rd.rule ? rd.rule : null;       // the second reading of this chord, when there is one
    const shown = s.textOverride ? written(s.textOverride) : s.label ? text(s.label) : "?", bar = barOf(state.score, s.start);
    // the first reading, from examples: its first sentence, then the rest
    let first; const rest = [];
    if (!s.label) first = "These notes, and anything close to them, are not among the chords it knows. So it gives no reading.";
    else {
      const top = Math.round((s.confidence || 0) * (s.support || 0)), wrote = `experts wrote ${num(text(s.label))} in ${count(top)} of ${count(s.support)} chord${s.support === 1 ? "" : "s"}.`;
      const begins = !!(rule && rule.where);      // the rule read a later part of this chord; the count belongs to the notes it begins with
      first = ev.level === "exact" ? (begins ? "For the notes this chord begins with, " : "For exactly these notes, ") + wrote
        : (begins ? "The notes this chord begins with are new to it. " : "Exactly these notes are new to it. ") + "It judged from the closest notes it knows, where " + wrote;
      if (ev.byContext && ev.notesAlone) {
        let j = i - 1; while (j >= 0 && (res.spans[j].status === "silent" || !res.spans[j].label)) j -= 1;
        const before = j >= 0 && res.spans[j].key && s.key && res.spans[j].key.name === s.key.name ? text(res.spans[j].label) : null;
        rest.push(`From the notes alone it would be ${num(text(ev.notesAlone))}. ` + (before ? `Coming after ${num(before)}, ` : "In this chain of chords, ") + `${num(text(s.label))} is the more usual step.`);
      }
      const alts = (s.alternatives || []).slice(0, 3);
      if (alts.length) rest.push("Other readings of these notes: " + alts.map(a => `${num(text(a.label))} (${count(a.count)})`).join(", ") + ".");
      if (s.cueDegree && !s.familyOverride && !s.textOverride) rest.push("Marked ? because the examples do not agree clearly enough on the color.");       // a chord the visitor changed carries no mark
    }
    const where = "Bar " + esc(bar) + (s.key ? ", in " + esc(keyName(s.key.name)) : "")
      + (rd && rd.notesLine ? " · " + esc(rd.notesLine) : "." + (s.input ? " The notes are " + esc(describeNotes(s.input)) + "." : ""));
    let html = `<button class="x" type="button" aria-label="Close">×</button>`
      + `<h3><span class="dot" style="background:${esc(hex)}"></span>${num(shown)}<span class="fam">${esc(fam.plain.en)}${(s.label || s.textOverride) && s.seventh ? ", seventh chord" : ""}</span></h3>`
      + `<p class="where">${where}</p>`;
    if (rule) {
      const name = (h, t, f) => `<p class="r-name"><span class="dot" style="background:${esc(h)}"></span>${num(t)}<span class="fam">${esc(f)}</span></p>`;
      const joined = rd.relation === "same-name" || rd.relation === "same-color";
      html += `<div class="pair">`
        + `<section class="reading"><h4>First reading <span>from examples · on the score</span></h4>${s.label ? name(hex, shown, fam.plain.en) : '<p class="r-name none">no reading</p>'}<p>${first}</p></section>`
        + `<section class="reading"><h4>Second reading <span>by rule</span></h4>${rule.kind === "chord" ? name(rule.hex || state.lang.unknown.triad, rule.text, rule.familyName || "") : '<p class="r-name none">no chord</p>'}`
        + (rule.sentences || []).map(t => "<p>" + esc(t) + "</p>").join("")
        + (rule.where ? `<p class="from">Read from ${esc(rule.where.text || ("bar " + rule.where.bar + ", beat " + rule.where.beat))}: notes ${esc(rule.where.notes)}.</p>` : "") + `</section></div>`
        + `<p class="verdict"><i class="pairmark${joined ? "" : " differ"}" aria-hidden="true"></i><span><b>${esc(rd.chip)}.</b>${rd.verdict ? " " + esc(rd.verdict) : ""}</span></p>`;
    } else html += [first].concat(rest).map(l => "<p>" + l + "</p>").join("");
    const extra = rd ? (rule ? rd.more || [] : []).map(esc).concat(rd.bar ? ["<b>The bar.</b> " + esc(rd.bar.sentence)] : []) : [];
    if (extra.length) html += `<div class="extra">${extra.map(x => "<p>" + x + "</p>").join("")}</div>`;
    if (rule) html += `<details><summary>More about the first reading</summary><div>${rest.map(l => "<p>" + l + "</p>").join("") || "<p>No other reading of these notes was counted.</p>"}</div></details>`
      + `<p class="shared">${esc(window.CKSecond.SHARED_LINE || "Both readings use the key the page found. If the key is wrong, both are wrong together.")}</p>`;      // always in sight, at the foot
    const box = document.createElement("div"); box.className = "why glass thick" + (rule ? "" : " one"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("tabindex", "-1");
    box.setAttribute("aria-label", rule ? "The two readings of this chord" : "Why this chord was read this way"); box.dataset.i = String(i); box.innerHTML = html;
    // beside the sheet, never inside it: the card may reach past the paper. On a phone it is a sheet at the bottom of the window.
    const stage = $("result"), sheet = $("sheet"), small = phone();
    (small ? document.body : stage).appendChild(box);
    const had = document.activeElement === el;          // the numeral was clicked or reached by keyboard (not the walk from the facts line)
    emit("why", { i, span: s, box, bar, piece: state.piece });       // the studio adds its block before the card is measured
    const foot = box.querySelector(".shared"); if (foot && foot.nextSibling) box.appendChild(foot);       // the shared-key line stays last, whatever was added
    pickAt(el, !!byKeys); rove(el);
    const ar = el.getBoundingClientRect();
    let shift = aimTop != null ? ar.top - aimTop : 0;       // one scroll for everything: first the numeral to where it was asked to rest
    if (!small) {             // always under the numeral, so the chord above it stays in view
      const gr = stage.getBoundingClientRect();
      box.style.left = Math.min(Math.max(10, ar.left - gr.left - 18), Math.max(10, gr.width - box.offsetWidth - 10)) + "px"; box.style.top = (ar.bottom - gr.top + 8) + "px";
      // then, if the card would end below the window, further up: as far as needed, but the chord (about 190 px above its numeral) stays under the navigation
      const over = ar.bottom + 8 + box.offsetHeight - shift - (window.innerHeight - 12);
      if (over > 0) shift += Math.max(0, Math.min(over, ar.top - shift - 190));
    } else {                  // the sheet at the bottom must not cover the chord it explains: bring the numeral above it
      const top = box.getBoundingClientRect().top;
      if (ar.bottom - shift > top - 12) shift = ar.bottom - top + 20;
    }
    if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: smooth() });
    box.dataset.left = String(sheet.scrollLeft);
    box.querySelector(".x").addEventListener("click", closeWhy);
    box.addEventListener("keydown", e => {        // Tab stays inside the card until it is closed
      if (e.key !== "Tab") return;
      const f = [...box.querySelectorAll("button, summary, a[href], input, select, textarea")].filter(x => !x.disabled && x.getClientRects().length);
      if (!f.length) return;
      const at = document.activeElement, first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (at === first || at === box)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
    });
    // focus goes into the card: to its close button when it was opened by keyboard, to the card itself after a click (so a screen reader says it, and Escape gives focus back)
    if (byKeys) box.querySelector(".x").focus({ preventScroll: true }); else if (had) box.focus({ preventScroll: true });
    box.dataset.hex = hex; chosen();
  }

  // ------------------------------------------------------------------ saving
  async function save() {
    if (!state.score) return;
    const harm = state.view === "harmony";
    const xml = harm ? harmony(true).xmlText : byPitch().xml;
    const edited = !!(state.lang.edited || state.result.spans.some(s => s.studio || s.familyOverride || s.textOverride));       // not the page as published: the name says so
    const stem = (String(state.meta.title || state.name).normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "score") + (harm ? "-color-key" : "-by-pitch") + (edited ? "-edited" : "");
    const done = msg => { status(msg); setTimeout(() => { if ($("status").textContent === msg) status(""); }, 6000); };       // the line is said, then it goes
    // A page that hosts this one where a download cannot start (a preview viewer) may take the file itself: it sets window.ColorKeySaveHook, which answers true,
    // or a sentence to show, when it has saved the file, and false to let the browser download it.
    if (typeof window.ColorKeySaveHook === "function") {
      try { const r = await window.ColorKeySaveHook({ filename: stem + ".musicxml", data: xml, type: "application/vnd.recordare.musicxml+xml" }); if (r) { done(typeof r === "string" ? r : "Saved."); return; } } catch (e) { console.error(e); }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" })); a.download = stem + ".musicxml";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    done("Saved. It opens in MuseScore, Dorico, Sibelius or Finale.");       // the browser itself shows the file's name
  }

  // ------------------------------------------------------------------ the wheel and its nine rows, the octave of keys
  // All drawn from the language in use: the colors, the names, and (for harmony) the order and width of the wedges.
  const C = 260, f1 = n => n.toFixed(1);
  const polar = (r, a) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
  function wedge(r0, r1, a0, a1, gap) {        // a ring segment drawn a little inside its edges, so its round stroke leaves a gap to the next
    const go = gap / r1 * 180 / Math.PI, gi = gap / r0 * 180 / Math.PI;
    const p = polar(r1, a0 + go), qq = polar(r1, a1 - go), u = polar(r0, a1 - gi), v = polar(r0, a0 + gi);
    return `M${f1(p[0])} ${f1(p[1])}A${r1} ${r1} 0 0 1 ${f1(qq[0])} ${f1(qq[1])}L${f1(u[0])} ${f1(u[1])}A${r0} ${r0} 0 0 0 ${f1(v[0])} ${f1(v[1])}Z`;
  }
  function inkOn(hex) {       // black or white, whichever reads better on this color
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.19 ? "#12161A" : "#FFFFFF";
  }
  const sentence = s => s.charAt(0).toUpperCase() + s.slice(1) + ".";
  const roleOf = f => sentence(String(((f.gloss || f.short || {}).en) || ""));       // "gloss" is the page's fuller sentence; "short" also goes into the legend of a downloaded score
  let wheelFams = [], wheelPinned = -1;
  function harmonyWheel() {   // may be called any number of times; the listeners are attached once, in wireWheel()
    const lang = state.lang, by = new Map(lang.families.map(f => [f.id, f]));
    const order = lang.wheel.order.filter(o => by.has(o.id)), fams = order.map(o => by.get(o.id));
    const cut = w => w.length > 11 ? w.slice(0, 10) + "…" : w;        // a name the visitor writes cannot leave its wedge
    let a = -order[0].span / 2, out = "";
    order.forEach((o, i) => {
      const f = fams[i], a0 = a, a1 = a + o.span, mid = (a0 + a1) / 2; a = a1;
      const t = polar(190, mid), s = polar(99, mid), push = polar(8, mid), words = String(f.plain.en).split(/\s+/).filter(Boolean).slice(0, 2).map(cut);
      out += `<g class="wedge" tabindex="0" role="button" data-k="${i}" aria-pressed="${i === wheelPinned}" aria-label="${esc(f.plain.en)}, ${esc(f.numerals)}. ${esc(roleOf(f))}" style="--px:${f1(push[0] - C)}px;--py:${f1(push[1] - C)}px">`
        + `<path d="${wedge(132, 246, a0, a1, 4.5)}" fill="${esc(f.triad)}" stroke="${esc(f.triad)}"/><path d="${wedge(78, 120, a0, a1, 4.5)}" fill="${esc(f.seventh)}" stroke="${esc(f.seventh)}"/>`
        + `<path class="w-ring" d="${wedge(72, 252, a0, a1, 0)}"/>`
        + `<text x="${f1(t[0])}" y="${f1(t[1])}" fill="${inkOn(f.triad)}" class="w-name">`       // the line step is in em, so two words keep their distance at any type size
        + words.map((w, j) => `<tspan x="${f1(t[0])}" dy="${j ? "1.12em" : (0.36 - (words.length - 1) * 0.56).toFixed(2) + "em"}">${esc(w)}</tspan>`).join("") + `</text>`
        + `<text x="${f1(s[0])}" y="${f1(s[1] + 5)}" fill="${inkOn(f.seventh)}" class="w-seven">7</text></g>`;
    });
    const a1 = 328, end = polar(40, a1), rad = a1 * Math.PI / 180, tx = Math.cos(rad), ty = Math.sin(rad), nx = Math.sin(rad), ny = -Math.cos(rad);      // the usual motion runs clockwise and comes home at the top
    const arrow = `<g class="w-turn" fill="none"><path d="M${f1(polar(40, 32)[0])} ${f1(polar(40, 32)[1])}A40 40 0 1 1 ${f1(end[0])} ${f1(end[1])}"/>`
      + `<path d="M${f1(end[0] - 11 * tx + 7 * nx)} ${f1(end[1] - 11 * ty + 7 * ny)}L${f1(end[0])} ${f1(end[1])}L${f1(end[0] - 11 * tx - 7 * nx)} ${f1(end[1] - 11 * ty - 7 * ny)}"/></g>`;
    $("harmonyWheel").innerHTML = `<svg viewBox="0 0 520 520" role="group" aria-label="Harmony Color wheel">${out}${arrow}</svg>`;
    // the rows: written once, then only updated, so an editor open under a row (and a color being dragged in it) is never torn down
    const list = $("harmonyList"), rows = [...list.children];
    if (rows.length !== fams.length || rows.some((li, i) => li.dataset.id !== fams[i].id)) {
      const cap = $("harmonyCap"); cap.remove(); cap.innerHTML = ""; wheelPinned = -1;
      list.innerHTML = fams.map((f, i) => `<li data-k="${i}" data-id="${esc(f.id)}"><span class="sw"><i></i><i></i></span><b></b><span class="num"></span><span class="say"></span></li>`).join("");
      list.after(cap);
    }
    fams.forEach((f, i) => { const li = list.children[i], sw = li.children[0].children;
      sw[0].style.background = f.triad; sw[1].style.background = f.seventh; li.children[1].textContent = f.plain.en; li.children[3].textContent = roleOf(f);
      li.children[2].innerHTML = esc(f.numerals).replace(/[♭♯]/g, m => `<span class="acc">${m}</span>`); });       // a flat inside a serif numeral is set close
    wheelFams = fams; show(wheelPinned, true);
  }
  // point at a wedge or a row: both light up. Click one: it stays, and the editor's host moves under its row (the "Make it yours" layer fills it).
  function show(i, keep) {
    for (const g of $("harmonyWheel").querySelectorAll(".wedge")) g.classList.toggle("on", +g.dataset.k === i);
    for (const li of $("harmonyList").children) li.classList.toggle("on", +li.dataset.k === i);
    if (!keep) Field.point(i >= 0 && wheelFams[i] ? wheelFams[i].triad : null);
  }
  function editor() {
    const cap = $("harmonyCap"), list = $("harmonyList"); cap.innerHTML = "";
    if (wheelPinned < 0 || !list.children[wheelPinned]) { list.after(cap); return; }
    list.children[wheelPinned].appendChild(cap);
    emit("family", { id: wheelFams[wheelPinned].id, cap });
  }
  function wireWheel() {      // called once
    const hosts = [$("harmonyWheel"), $("harmonyList")], of = e => { const g = e.target.closest ? e.target.closest("[data-k]") : null; return g ? +g.dataset.k : -1; };
    const pin = i => { wheelPinned = wheelPinned === i ? -1 : i; show(wheelPinned, true); editor(); for (const g of hosts[0].querySelectorAll(".wedge")) g.setAttribute("aria-pressed", String(+g.dataset.k === wheelPinned)); };
    hosts.forEach(h => {
      h.addEventListener("pointerover", e => { const i = of(e); if (i >= 0 && e.pointerType !== "touch") show(i); });
      h.addEventListener("pointerleave", () => { show(wheelPinned, true); Field.point(null); });
      h.addEventListener("click", e => { if (e.target.closest(".cap")) return; const i = of(e); if (i >= 0) pin(i); });
    });
    hosts[0].addEventListener("focusin", e => { const i = of(e); if (i >= 0) show(i, true); });
    hosts[0].addEventListener("focusout", e => { if (!hosts[0].contains(e.relatedTarget)) show(wheelPinned, true); });
    hosts[0].addEventListener("keydown", e => { const i = of(e); if (i >= 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pin(i); } });
  }
  function pitchKeys() {      // Pitch Color: one octave of keys, a notehead of the note's color on each
    const P = state.lang.pitch, W = 58, H = 128, top = 44, whites = [0, 2, 4, 5, 7, 9, 11], blacks = [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]];
    const head = (x, y, c) => `<ellipse cx="${x}" cy="${y}" rx="9.4" ry="6.8" transform="rotate(-20 ${x} ${y})" fill="${esc(c)}"/>`;
    let out = "";
    whites.forEach((pc, i) => { const x = i * W; out += `<rect class="wk" x="${x + .5}" y="${top + .5}" width="${W - 1}" height="${H}" rx="7"/>${head(x + W / 2, top + H - 24, P.colors[pc])}<text class="kn" x="${x + W / 2}" y="${top + H + 22}">${esc(P.names[pc])}</text>`; });
    blacks.forEach(b => { const pc = b[0], x = b[1] * W, two = P.names[pc].split(" / ");
      out += `<rect class="bk" x="${x - 17}" y="${top}" width="34" height="${H * .58}" rx="5"/>${head(x, top + H * .58 - 17, P.colors[pc])}<text class="kn" x="${x}" y="${top - (two.length > 1 ? 24 : 8)}">${esc(two[0])}</text>${two.length > 1 ? `<text class="kn" x="${x}" y="${top - 8}">${esc(two[1])}</text>` : ""}`; });
    $("pitchKeys").innerHTML = `<svg viewBox="0 0 ${7 * W} ${top + H + 30}" role="img" aria-label="One octave of piano keys, each with a notehead in the color of its note">${out}</svg>`;
    $("pitchList").innerHTML = P.names.map(x => `<li>${esc(x)}</li>`).join("");
  }

  // ------------------------------------------------------------------ the language in use (the published one, or the visitor's)
  function paintChrome() {    // the page takes its few colors from the same data as the score
    const root = document.documentElement.style;
    for (const f of state.lang.families) { root.setProperty("--c-" + f.id, f.triad); root.setProperty("--c-" + f.id + "-7", f.seventh); }
  }
  // light: a color is being dragged. Wheel, keys, chrome and legend follow at once; the score is drawn again when the value is committed.
  async function setLanguage(lang, light) {
    state.lang = lang; paintChrome(); harmonyWheel(); pitchKeys();
    if (!light && wheelPinned >= 0) editor();
    if (window.ColorKeyOMR && window.ColorKeyOMR.repaint) { try { window.ColorKeyOMR.repaint(); } catch (e) { console.error(e); } }
    if (!state.score || $("result").hidden) return;
    if (light) { legend(); Field.fromPiece(homeHex()); chosen(); } else await draw();
  }

  // ------------------------------------------------------------------ the backdrop
  // Three soft fields, each a small canvas painted once and stretched by CSS, so moving one costs only a transform. They lean toward the pointer,
  // a press on bare ground sends one ring out, and when everything has settled the loop stops. It needs only the element
  //   <div class="field" id="field" aria-hidden="true"><canvas class="f"></canvas><canvas class="f"></canvas><canvas class="f"></canvas><i class="ring"></i></div>
  // as the first child of .wrap, and the tokens --f-l --f-c --f-a --light --light-a (and, in the style sheet, --ring-a --ring-b).
  // Calls:  Field.theme()            after data-theme changes, and once at the start
  //         Field.enter()            once at the start: the two fields drift in
  //         Field.fromPiece(hex)     the color of the family that fills most of the piece on screen
  //         Field.choose(hex|null)   the chord or family the visitor has chosen (open "why" card, pinned legend entry)
  //         Field.point(hex|null)    what the pointer is over (a chord, a legend entry, a wedge or its row)
  //         Field.demo(x, y, phase)  for still pictures only (?p=x,y[,phase])
  // Switch for checking:  ?motion=off  (the same as a visitor who asked for reduced motion)
  function makeField() {
    const root = document.documentElement, host = document.getElementById("field"), els = [...host.querySelectorAll("canvas.f")], ringEl = host.querySelector(".ring");
    const reduce = media("(prefers-reduced-motion: reduce)"), off = /[?&]motion=off\b/.test(location.search), still = () => reduce.matches || off;
    const N = 192, LIFE = 1.5;
    const F = [       // hx, hy: where it rests (fractions of the window). size: its width, times the window's longer side. lean: how far it follows the pointer. tau: how slowly, in seconds.
      { hx: .16, hy: .12, size: 1.22, lean: .30, tau: 1.0 },
      { hx: .86, hy: .84, size: 1.22, lean: .36, tau: 1.3 },
      { light: true, size: .56, tau: .30 }
    ];
    const QUIET = "a, button, input, select, textarea, label, summary, [role=button], [role=radio], .sheet, .why, .wheel, .omr-page, .roles";
    const noise = new Float32Array(N * N); { let s = 12345; for (let i = 0; i < noise.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; noise[i] = s / 4294967296 - .5; } }
    const css = n => getComputedStyle(root).getPropertyValue(n).trim();
    const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4), gam = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    function hueOf(hex) {              // sRGB to OKLCH: chroma and hue only
      const [r, g, b] = rgbOf(hex).map(v => lin(v / 255));
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
      return [Math.hypot(A, B), Math.atan2(B, A)];
    }
    function oklch(L, C, h) {          // OKLCH to sRGB, 0 to 255
      const A = C * Math.cos(h), B = C * Math.sin(h);
      const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3), m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3), s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
      return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(v => 255 * gam(Math.min(1, Math.max(0, v))));
    }
    let T = { l: .915, c: .066, a: .95, light: [255, 255, 255], lightA: .8, own: false };
    let vw = 1, vh = 1, raf = 0, last = 0, ring = null, lit = null, pend = null, touchT = 0, frozen = false, sway = 0, held = null, slow = 0, calm = false;
    const P = { x: 0, y: 0, on: false }, src = [null, null, null];          // src: the language color each field echoes (null: the plain light)
    // every tint has the same lightness and at most the same chroma, whatever color it echoes, so text over it keeps its contrast
    const tint = hex => { const [C, h] = hueOf(hex); return oklch(T.l, Math.min(T.c, C * .5), h); };
    const air = () => oklch(T.l, T.c * .55, 4.45);          // the far field at rest: hue 255 degrees, about half the chroma
    function aim(k) {
      const f = F[k], hex = src[k];
      // the pointer's light: the color of what it is over; over nothing, the piece's own hue where plain light would not show (a light ground), plain light elsewhere
      if (k === 2) { const own = hex || (T.own ? src[0] || "#00A22B" : null); f.to = own ? tint(own) : T.light.slice(); f.aTo = own ? T.a * .9 : T.lightA; }
      else if (k === 1) { f.to = hex ? tint(hex) : air(); f.aTo = hex ? T.a * .8 : T.a; }
      else { f.to = tint(hex || "#00A22B"); f.aTo = T.a; }
    }
    function paint(f) {
      const ctx = f.el.getContext("2d"); if (!ctx) return;
      const img = f.img || (f.img = ctx.createImageData(N, N)), d = img.data, c = (N - 1) / 2, r = Math.round(f.c[0]), g = Math.round(f.c[1]), b = Math.round(f.c[2]), peak = f.a * 255;
      for (let y = 0, o = 0, i = 0; y < N; y++) for (let x = 0; x < N; x++, o += 4, i++) {
        const qq = ((x - c) * (x - c) + (y - c) * (y - c)) / (c * c), a = qq < 1 ? (1 - qq) * (1 - qq) * peak + noise[i] : 0;
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = a < 0 ? 0 : a + .5 | 0;
      }
      ctx.putImageData(img, 0, 0);
    }
    function size() {
      vw = window.innerWidth; vh = window.innerHeight; const side = Math.max(vw, vh);
      F.forEach(f => { const S = Math.round(f.size * side); f.el.style.width = f.el.style.height = S + "px"; f.el.style.margin = (-S / 2) + "px 0 0 " + (-S / 2) + "px"; });
    }
    // where a field wants to be: its resting place, swayed a little by how far the page is scrolled (so it also lives on a touch screen), then leaning toward the pointer
    function want(f, k) {
      if (f.light) return [P.x, P.y];
      const ph = (still() ? 0 : sway) / 1300 + k * 2.1; let x = (f.hx + .06 * Math.sin(ph)) * vw, y = (f.hy + .09 * Math.cos(ph * .8)) * vh;
      if (P.on && !calm) { x += (P.x - x) * f.lean; y += (P.y - y) * f.lean; }
      return [x, y];
    }
    function put(f) { f.el.style.transform = "translate3d(" + f.x.toFixed(1) + "px," + f.y.toFixed(1) + "px,0)"; if (f.light) f.el.style.opacity = f.o.toFixed(3); }
    function ringAt(x, y, p) {         // p runs from 0 (the press) to 1 (gone): the ring widens quickly, then slows, and fades as it goes
      const e = 1 - Math.pow(1 - p, 2.2);
      ringEl.style.transform = "translate3d(" + x.toFixed(1) + "px," + y.toFixed(1) + "px,0) scale(" + (.18 + 2.3 * e).toFixed(3) + ")";
      ringEl.style.opacity = (Math.min(1, p * LIFE / .08) * Math.pow(1 - p, .8)).toFixed(3);
    }
    function settle() {                // no easing: used at the start, on resize, on a theme change and for a reader who asked for less motion
      if (held) { P.x = held.x * vw; P.y = held.y * vh; P.on = true; }
      F.forEach((f, k) => { aim(k); const w = want(f, k), same = f.c && f.a === f.aTo && f.c.every((v, i) => v === f.to[i]);
        f.x = w[0]; f.y = w[1]; f.c = f.to.slice(); f.a = f.aTo; f.o = f.light ? (P.on ? 1 : 0) : 1; if (!same) paint(f); put(f); });       // a canvas is painted again only when its color changed
      if (held && held.phase >= 0) ringAt(P.x, P.y, held.phase); else ringEl.style.opacity = "0";
    }
    function tick(now) {
      raf = 0; const gap = last ? now - last : 16, dt = Math.min(.05, gap / 1000); last = now; let busy = false;
      // a device that cannot keep up (frames more than 42 ms apart, 45 times more often than not) gets a backdrop that no longer follows the pointer
      if (gap > 42 && gap < 400) { if (++slow > 45 && !calm) { calm = true; ring = null; ringEl.style.opacity = "0"; } } else if (slow > 0) slow--;
      if (pend) { rim(pend); pend = null; }
      F.forEach((f, n) => {
        const w = want(f, n), k = 1 - Math.exp(-dt / f.tau), kc = 1 - Math.exp(-dt / .28);
        f.x += (w[0] - f.x) * k; f.y += (w[1] - f.y) * k;
        if (Math.abs(w[0] - f.x) > 1 || Math.abs(w[1] - f.y) > 1) busy = true; else { f.x = w[0]; f.y = w[1]; }
        if (f.light) { const o = P.on && !calm ? 1 : 0; f.o += (o - f.o) * (1 - Math.exp(-dt / .5)); if (Math.abs(o - f.o) > .01) busy = true; else f.o = o; }
        let moved = 0; for (let i = 0; i < 3; i++) { const d = f.to[i] - f.c[i]; moved = Math.max(moved, Math.abs(d)); f.c[i] += d * kc; }
        const da = f.aTo - f.a; f.a += da * kc; moved = Math.max(moved, Math.abs(da) * 255);
        if (moved > .6) { paint(f); busy = true; } else if (moved > 0) { f.c = f.to.slice(); f.a = f.aTo; paint(f); }
        put(f);
      });
      if (ring) {
        const age = (now - ring.t0) / 1000, p = age / LIFE;
        if (p >= 1) { ring = null; ringEl.style.opacity = "0"; }
        else { ringAt(ring.x, ring.y, p); busy = true; }
      }
      if (busy) raf = requestAnimationFrame(tick); else last = 0;          // settled: nothing runs until the next input
    }
    function wake() { if (frozen || still() || document.hidden) { if (still() && !frozen) settle(); return; } if (!raf) raf = requestAnimationFrame(tick); }
    function rim(e) {                  // the pane under the pointer learns where the pointer is; no other element is written to
      const p = e.target && e.target.closest ? e.target.closest(".pane") : null;
      if (p !== lit) { if (lit) lit.classList.remove("lit"); lit = p; if (p) p.classList.add("lit"); }
      if (p) { const r = p.getBoundingClientRect(); p.style.setProperty("--lx", Math.round(e.clientX - r.left) + "px"); p.style.setProperty("--ly", Math.round(e.clientY - r.top) + "px"); }
    }
    function theme() {
      T = { l: +css("--f-l"), c: +css("--f-c"), a: +css("--f-a"), light: rgbOf(css("--light")), lightA: +css("--light-a"), own: css("--light-own") === "1" };
      F.forEach(f => { f.c = null; }); settle();
    }
    window.addEventListener("pointermove", e => { if (still() || frozen || e.pointerType === "touch") return; P.x = e.clientX; P.y = e.clientY; P.on = true; pend = e; wake(); }, { passive: true });
    root.addEventListener("pointerleave", () => { P.on = false; if (lit) { lit.classList.remove("lit"); lit = null; } wake(); });
    window.addEventListener("pointerdown", e => {
      if (still() || frozen) return;
      if (e.pointerType === "touch") { P.x = e.clientX; P.y = e.clientY; P.on = true; clearTimeout(touchT); touchT = setTimeout(() => { P.on = false; wake(); }, 1800); }
      if (!calm && !(e.target.closest && e.target.closest(QUIET))) ring = { x: e.clientX, y: e.clientY, t0: performance.now() };
      wake();
    }, { passive: true });
    window.addEventListener("scroll", () => { if (still()) return; sway = window.scrollY; wake(); }, { passive: true });       // a reader who asked for less motion gets a backdrop that stays where it is
    window.addEventListener("resize", () => { size(); if (!raf) settle(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; } else wake(); });
    watch(reduce, () => { if (raf) cancelAnimationFrame(raf); raf = 0; P.on = false; ring = null; sway = window.scrollY; settle(); });
    F.forEach((f, k) => { f.el = els[k]; f.el.width = f.el.height = N; });
    size();
    return {
      theme,
      enter() {                        // once, when the page opens: the two fields drift in from a little outside their resting places
        if (still() || frozen || document.hidden) return;
        F[0].x -= .10 * vw; F[0].y -= .06 * vh; F[1].x += .10 * vw; F[1].y += .06 * vh; put(F[0]); put(F[1]); wake();
      },
      fromPiece(hex) { src[0] = hex; aim(0); aim(2); if (still() || frozen) settle(); else wake(); },                          // the family that fills most of the piece on screen
      choose(hex) { if (src[1] === (hex || null)) return; src[1] = hex || null; aim(1); if (still() || frozen) settle(); else wake(); },      // the chord or family the visitor has chosen
      point(hex) { if (src[2] === (hex || null)) return; src[2] = hex || null; aim(2); if (still() || frozen) settle(); else wake(); },   // the light takes the color of what is pointed at
      demo(x, y, phase) {              // for still pictures of the mock: the pointer resting at one place (fractions of the window), one ring part of the way out
        frozen = true; held = { x, y, phase }; settle();
        const el = document.elementFromPoint(P.x, P.y); if (el) rim({ target: el, clientX: P.x, clientY: P.y });
      }
    };
  }
  const Field = (function () {       // the backdrop is decoration: if it cannot be built, or a call to it fails, the page goes on without it
    const no = () => {}, none = { theme: no, enter: no, fromPiece: no, choose: no, point: no, demo: no };
    let real = null; try { real = makeField(); } catch (e) { console.error(e); return none; }
    const out = {}; for (const k of Object.keys(none)) out[k] = (...a) => { try { return real[k](...a); } catch (e) { console.error(e); } };
    return out;
  })();

  // ------------------------------------------------------------------ start
  async function boot() {
    const get = async p => (await fetch(p)).json();
    try {
      const [lang, dict, prog, examples, about] = await Promise.all([get("data/language.json"), get("data/dictionary.json"), get("data/progression.json"), get("examples/examples.json"), get("data/about.json")]);
      state.base = lang; state.lang = lang; state.about = about || {};
      state.dict = { entries: dict.entries, hash: dict.hash, partitions: "train+validation" };
      state.prog = { model: new CK.ProgressionModel(prog), weight: prog.selected.weight, kappa: prog.selected.kappa, prior: prog.selected.prior };
      if (Studio) {             // the visitor's own colors and readings, kept in this browser
        try {
          const palettes = state.about.palettes ? await get("data/palettes.json") : null;
          Studio.init({ base: lang, palettes, dict: state.dict }); state.lang = Studio.language() || lang;
        } catch (e) { console.error(e); state.lang = lang; }
      }
      else for (const el of document.querySelectorAll('#yours, a[href="#yours"]')) el.hidden = true;       // the layer is not running (?studio=0, or its script did not load): its section and the links to it step aside
      state.examples = examples; state.ready = true;
      $("foot").textContent = "Version " + about.version + " · " + about.date;
      $("tries").insertAdjacentHTML("beforeend", examples.map(e => `<button class="chip" type="button" data-ex="${esc(e.id)}">${esc(e.short)}</button>`).join(""));
      if (window.ColorKeyOMR) {       // the reader of printed music is here: say so in the drop zone
        const t = $("dropTitle");          // nothing can be dragged on a touch screen
        t.textContent = (touchOnly() && t.dataset.touch) || t.dataset.all || t.textContent;
        const all = $("dropSubAll"); if (all) $("dropSub").innerHTML = all.innerHTML;
      }
      paintChrome(); soloRules(); Field.fromPiece(state.lang.families[0].triad);
      harmonyWheel(); wireWheel(); pitchKeys();
    } catch (err) { console.error(err); $("result").hidden = false; status("The page could not load its data. Reload to try again.", "error"); return; }
    if (query.get("full")) $("sheet").style.overflow = "visible";
    if (query.get("src")) {       // a file named in the address (for checking): a score, a PDF or a picture. If it cannot be opened, the first example is, and a line says so.
      let ok = false;
      try { const r = await fetch(query.get("src")); if (r.ok) { await openAny(new File([await r.blob()], query.get("src").split("/").pop().split("?")[0])); ok = !!state.score || !$("omr").hidden; } } catch (e) { console.error(e); }
      if (!ok) { const said = $("dropNote").textContent; await openExample(state.examples[0].id, true); dropNote(said || "The file named in the address could not be found. This is the first example."); }
    }
    else await openExample(state.examples.some(e => e.id === query.get("ex")) ? query.get("ex") : state.examples[0].id, !query.get("ex"));     // open on a short piece, so the first look shows what the page does
    if (query.get("view") === "pitch") { state.view = "pitch"; setView(); await draw(); }
    const at = location.hash === "#reference" ? $("colors") : /^#[a-z]+$/.test(location.hash) ? document.querySelector(location.hash) : null;
    if (at && at.id !== "top") at.scrollIntoView();      // the score above has just taken its room
    if (query.has("p")) { const d = query.get("p").split(",").map(Number); Field.demo(d[0], d[1], d.length > 2 ? d[2] : -1); }       // for still pictures
  }
  function setView() { for (const b of document.querySelectorAll("#seg button")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view)); }

  // opening a score
  $("file").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f && state.ready) openAny(f); e.target.value = ""; });
  $("drop").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  $("openBtn").addEventListener("click", () => $("file").click());
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  ["dragenter", "dragover"].forEach(ev => window.addEventListener(ev, e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.add("dragging"); }));
  window.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  window.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.remove("dragging"); const f = e.dataTransfer.files[0]; if (f && state.ready) openAny(f); });
  $("tries").addEventListener("click", e => { const b = e.target.closest("button[data-ex]"); if (b && state.ready) openExample(b.dataset.ex); });
  // the bar above the score
  $("seg").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (!b || b.dataset.view === state.view || !state.score) return; state.view = b.dataset.view; state.pinned = null; setView(); draw(); });
  $("save").addEventListener("click", save);
  $("print").addEventListener("click", () => window.print());
  $("keys").addEventListener("click", e => { const b = e.target.closest("button[data-bar]"); if (b) goToBar(+b.dataset.bar); });
  $("facts").addEventListener("click", e => { const b = e.target.closest ? e.target.closest("#differNext, #barsNext") : null; if (b) { e.stopPropagation(); walk(b.id === "barsNext" ? "bars" : "differ"); } });
  $("legend").addEventListener("pointerover", e => { const b = e.target.closest("button.chip"); if (b && e.pointerType !== "touch") { solo(b.dataset.k); Field.point(b.dataset.hex); } });
  $("legend").addEventListener("pointerleave", () => { solo(state.pinned); Field.point(null); });
  $("legend").addEventListener("focusin", e => { const b = e.target.closest("button.chip"); if (b) solo(b.dataset.k); });
  $("legend").addEventListener("focusout", () => solo(state.pinned));
  $("legend").addEventListener("click", e => { const b = e.target.closest("button.chip"); if (!b) return;
    state.pinned = state.pinned === b.dataset.k ? null : b.dataset.k;
    for (const c of $("legend").querySelectorAll(".chip")) c.setAttribute("aria-pressed", String(c.dataset.k === state.pinned)); solo(state.pinned); chosen(); });
  // the score: the light under the pointer takes the color of the chord it is over; a numeral opens its card
  $("score").addEventListener("pointerover", e => { const g = e.target.closest ? e.target.closest("[data-fam]") : null; Field.point(g ? hexOfKey(g.dataset.fam) : null); });
  $("score").addEventListener("pointerleave", () => Field.point(null));
  let lastPointer = "mouse"; $("sheet").addEventListener("pointerdown", e => { lastPointer = e.pointerType || "mouse"; }, { passive: true });
  $("score").addEventListener("click", e => {
    let el = e.target.closest ? e.target.closest("text[data-i]") : null;
    if (!el && lastPointer === "touch" && state.view === "harmony") { el = nearNumeral(e.clientX, e.clientY, 22); if (el) el.focus({ preventScroll: true }); }       // a finger beside a numeral means that numeral
    if (el) { e.stopPropagation(); $("toc").open = false; why(parseInt(el.getAttribute("data-i"), 10), el); }
  });
  $("score").addEventListener("keydown", e => {
    const el = e.target.closest ? e.target.closest("text[data-i]") : null; if (!el) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); why(parseInt(el.getAttribute("data-i"), 10), el, true); return; }
    const to = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "home", End: "end" }[e.key];
    if (to !== undefined && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); step(el, to); }
  });
  $("score").addEventListener("focusin", e => { const el = e.target.closest ? e.target.closest("text[data-i]") : null; if (el && !document.querySelector(".why")) { rove(el); let keys = true; try { keys = el.matches(":focus-visible"); } catch (x) { /* older browsers: show it */ } if (keys) pickAt(el, true); } });
  $("score").addEventListener("focusout", () => { if (!document.querySelector(".why")) unpick(); });
  $("sheet").addEventListener("scroll", () => { const box = document.querySelector(".why"); if (box && Math.abs($("sheet").scrollLeft - (+box.dataset.left || 0)) > 2) closeWhy(); });       // the card does not live in the sheet
  document.addEventListener("click", e => {        // a click elsewhere closes the card and the menu (the path is asked, because a control inside the card may have replaced itself)
    const path = e.composedPath ? e.composedPath() : [], inside = sel => path.some(n => n.matches && n.matches(sel)) || !!(e.target.closest && e.target.closest(sel));
    if (!inside(".why") && !inside("text[data-i]")) closeWhy(); if (!inside("#toc")) $("toc").open = false; });
  document.addEventListener("keydown", e => { if (e.key !== "Escape") return; closeWhy(); const t = $("toc"); if (t.open) { const inside = t.contains(document.activeElement); t.open = false; if (inside) t.querySelector("summary").focus(); } });
  // navigation and theme (the head script has already set data-theme before the first paint)
  $("toc").addEventListener("click", e => { if (e.target.closest("a")) $("toc").open = false; });
  $("toc").addEventListener("focusout", e => { if (e.relatedTarget && !$("toc").contains(e.relatedTarget)) $("toc").open = false; });       // tabbed out of: it closes behind the reader
  if ("IntersectionObserver" in window) {     // the section being read is marked in the navigation
    const links = [...$("navLinks").querySelectorAll("a")], bands = [...document.querySelectorAll("section.band")], seen = new Set();
    const io = new IntersectionObserver(es => {       // a thin band of the window, a little above its middle: the section that crosses it is the current one (none above the first)
      for (const en of es) { if (en.isIntersecting) seen.add(en.target.id); else seen.delete(en.target.id); }
      const cur = bands.filter(s => seen.has(s.id)).pop();
      for (const a of links) { if (cur && a.getAttribute("href") === "#" + cur.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); }
    }, { rootMargin: "-40% 0px -55% 0px" });
    bands.forEach(s => io.observe(s));
  }
  $("themeBtn").addEventListener("click", () => { const d = document.documentElement, to = d.dataset.theme === "dark" ? "light" : "dark"; d.dataset.theme = to; try { localStorage.setItem("colorkey-theme", to); } catch (e) { /* not kept */ } Field.theme(); });
  watch(media("(prefers-color-scheme: dark)"), e => { try { if (localStorage.getItem("colorkey-theme")) return; } catch (x) { /* follow the system */ } if (query.get("theme")) return; document.documentElement.dataset.theme = e.matches ? "dark" : "light"; Field.theme(); });
  let timer = null;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => { const w = $("score").clientWidth; if (state.score && !$("result").hidden && Math.abs(w - lastW) > 24) { lastW = w; draw(); } }, 250); });

  // Paper. One drawing per system, each a window onto the score's own drawing, so a page break falls between two systems and never through one,
  // and the title shares the first page. Written just before printing and taken away after; where a browser does not say that it is about to print, the score prints as it is.
  function bySystem() {
    const out = $("printScore"), svg = $("score").querySelector("svg"); out.textContent = ""; document.body.classList.remove("by-system");
    if (!svg || $("result").hidden || !state.osmd) return;
    try {
      const box = svg.getBoundingClientRect(), W = svg.width.baseVal.value, H = svg.height.baseVal.value, k = H / box.height; if (!(W > 0 && H > 0 && box.height > 0)) return;
      const unit = 10 * (state.osmd.zoom || state.osmd.Zoom || 1), systems = state.osmd.GraphicSheet.MusicPages[0].MusicSystems;
      const tops = systems.map(sy => sy.PositionAndShape.AbsolutePosition.y * unit); if (tops.length < 2) return;
      const ink = new Uint8Array(Math.ceil(H) + 2);       // which rows of the drawing hold ink
      for (const el of svg.querySelectorAll("path, text, rect, ellipse, circle, line, polygon, polyline")) {
        const r = el.getBoundingClientRect(); if (!(r.height > 0 || r.width > 0) || r.height * k > H * 0.6) continue;
        for (let y = Math.max(0, Math.floor((r.top - box.top) * k)), z = Math.min(H, Math.ceil((r.bottom - box.top) * k)); y <= z; y++) ink[y] = 1;
      }
      const cuts = [0];
      for (let i = 1; i < tops.length; i++) {             // between two systems: the middle of the widest empty band above the lower one
        const lo = Math.floor((tops[i - 1] + tops[i]) / 2), hi = Math.floor(tops[i]); let best = -1, bw = 0, run = 0;
        for (let y = lo; y <= hi; y++) { if (!ink[y]) { run += 1; if (run > bw) { bw = run; best = y - run / 2; } } else run = 0; }
        cuts.push(best < 0 ? (lo + hi) / 2 : best);
      }
      cuts.push(H);
      if (!svg.id) svg.id = "scoreDrawing";
      const NS = "http://www.w3.org/2000/svg";
      for (let i = 0; i + 1 < cuts.length; i++) {
        const part = document.createElementNS(NS, "svg"), use = document.createElementNS(NS, "use"), h = cuts[i + 1] - cuts[i];
        part.setAttribute("viewBox", "0 " + cuts[i].toFixed(1) + " " + W + " " + h.toFixed(1)); use.setAttribute("href", "#" + svg.id);
        part.appendChild(use); out.appendChild(part);
      }
      document.body.classList.add("by-system");
    } catch (e) { console.error(e); out.textContent = ""; document.body.classList.remove("by-system"); }
  }
  window.addEventListener("beforeprint", bySystem);
  window.addEventListener("afterprint", () => { $("printScore").textContent = ""; document.body.classList.remove("by-system"); });

  window.ColorKeyPage = { state, openFile, on, setLanguage, paintChrome, hexOf, redraw: () => (state.score && !$("result").hidden ? draw() : null), describeNotes, pretty, keyName, closeWhy, field: Field };
  Field.theme(); Field.enter();       // the backdrop is there before the data arrives; it takes the piece's color when a piece is drawn
  boot();
})();
