/* Color Key: page logic. Everything runs in the browser; a dropped score is never sent anywhere. */
(function () {
  "use strict";
  const CK = window.ColorKey, OV = window.ColorKeyOverlay, $ = id => document.getElementById(id);
  const state = { lang: null, dict: null, prog: null, examples: [], name: "score", meta: {}, score: null, result: null, view: "harmony",
                  osmd: null, xmlShown: null, same: null, token: 0, ready: false };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  const pretty = s => String(s || "").replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/(^|[^A-Za-z])bb(?=[IViv\d])/g, "$1𝄫").replace(/(^|[^A-Za-z])b(?=[IViv\d])/g, "$1♭");
  const keyName = n => { const m = /^([A-G])(##|#|bb|b)? (major|minor)$/.exec(n || ""); return m ? m[1] + ({ "#": "♯", "b": "♭", "##": "𝄪", "bb": "𝄫" }[m[2]] || "") + " " + m[3] : (n || ""); };
  const count = n => n.toLocaleString("en-US");
  const pause = () => new Promise(r => setTimeout(r, 30));
  function status(text, kind) { const el = $("status"); el.textContent = text || ""; el.className = "status" + (kind === "error" ? " error" : ""); }
  function dropNote(text) { $("dropNote").textContent = text || ""; }
  const still = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

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
  // A PDF or a photo of printed music is handed to the reader (window.ColorKeyOMR, loaded separately) when it is there. MusicXML is read here.
  const isPrinted = f => /\.(pdf|png|jpe?g)$/i.test(f.name || "") || /^(application\/pdf|image\/(png|jpeg))$/.test(f.type || "");
  function openAny(file) {
    dropNote("");
    if (!isPrinted(file)) return openFile(file);
    if (window.ColorKeyOMR && typeof window.ColorKeyOMR.open === "function") return window.ColorKeyOMR.open(file);
    dropNote("Reading printed music is being built. For now, drop a MusicXML file.");
  }
  async function openFile(file) {
    closeWhy();
    try {
      $("result").hidden = false; status("Reading the file…"); await pause();
      const xml = /\.mxl$/i.test(file.name) ? (await CK.unpackMxl(await file.arrayBuffer(), JSZip)).xmlText : await file.text();
      const stem = file.name.replace(/\.(musicxml|xml|mxl)$/i, "");
      await run(stem, xml, titleOf(xml, stem));
    } catch (err) { console.error(err); const msg = "This file could not be read as MusicXML. " + (err && err.message ? err.message : ""); status(msg, "error"); dropNote(msg); }
  }
  async function openExample(id) {
    closeWhy();
    const ex = state.examples.find(e => e.id === id); if (!ex) return;
    try {
      $("result").hidden = false; status("Opening " + ex.title + "…"); await pause();
      const buf = await (await fetch(ex.file)).arrayBuffer();
      const xml = /\.mxl$/i.test(ex.file) ? (await CK.unpackMxl(buf, JSZip)).xmlText : new TextDecoder().decode(buf);
      await run(ex.id, xml, { title: ex.title, composer: ex.composer });
    } catch (err) { console.error(err); status("The example could not be opened.", "error"); }
  }
  async function run(name, xml, meta) {
    state.name = name; state.meta = meta; state.same = null;
    $("piece").textContent = meta.title || name; $("by").textContent = meta.composer || "";
    status("Finding the key and reading the chords…"); await pause();
    state.score = CK.readScore(xml);
    state.result = CK.analyze(state.score, state.dict, { backoff: true, keyStartPrior: true, confidentFrequency: 0.7,
      progression: { model: state.prog.model, weight: state.prog.weight, kappa: state.prog.kappa, prior: state.prog.prior } });
    await draw();
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
  function labels() {
    const score = state.score, out = []; let prevKey = null;
    state.result.spans.forEach((s, i) => {
      if (s.status === "silent") return;
      const mi = measureIndexAt(score, s.start), q = s.start.sub(score.measures[mi].start).num();
      const changed = !!s.key && s.key.name !== prevKey;
      const parts = s.label ? CK.labelParts(s.label, s.key ? s.key.mode : null) : null;
      const base = { prefix: changed ? CK.keyPrefix(s.key) : null, inlineFigure: "", cue: !!(s.cueDegree && s.label) };
      const line = parts ? Object.assign(base, parts) : Object.assign(base, { acc: "", numeral: "?", quality: "", figures: [], adds: "", target: "", special: "" });
      out.push({ id: i, measureIndex: mi, q, lines: [line], color: s.hex || state.lang.unknown.triad });
      if (s.key) prevKey = s.key.name;
    });
    return out;
  }

  // ------------------------------------------------------------------ drawing
  async function draw() {
    const token = ++state.token, host = $("score");
    closeWhy(); clearHere(); status("Drawing the score…"); await pause();
    const harm = state.view === "harmony";
    const colored = harm ? harmony(false) : null, pitch = harm ? null : byPitch();
    const xml = harm ? colored.renderXmlText : pitch.xml;
    if (!state.osmd) {
      state.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(host, { autoResize: false, backend: "svg", drawTitle: false, drawSubtitle: false, drawComposer: false, drawLyricist: false,
        drawCredits: false, drawPartNames: false, drawPartAbbreviations: false, drawMeasureNumbers: true, coloringEnabled: true, colorStemsLikeNoteheads: true, pageFormat: "Endless", drawMetronomeMarks: false });
    }
    const osmd = state.osmd;
    await osmd.load(xml);
    if (token !== state.token) return;
    const w = host.clientWidth || 900, R = osmd.EngravingRules;
    osmd.Zoom = w < 520 ? 0.6 : w < 800 ? 0.78 : 0.95;
    if (!state.rules0) state.rules0 = { staves: R.MinSkyBottomDistBetweenStaves, between: R.BetweenStaffDistance, staff: R.StaffDistance };
    R.MinSkyBottomDistBetweenStaves = state.rules0.staves; R.BetweenStaffDistance = state.rules0.between; R.StaffDistance = state.rules0.staff;
    R.MinSkyBottomDistBetweenSystems = harm ? 11.5 : 5; R.MinimumDistanceBetweenSystems = harm ? 6 : 4;
    osmd.render();
    const lab = harm ? labels() : [];
    const over = () => OV.drawOverlay(osmd, host, lab, [], { size: 18, font: "Georgia, 'Times New Roman', serif", noteFont: "system-ui, sans-serif", noteColor: "#555555", cueColor: "#555555" });
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
    state.xmlShown = xml; state.layout = res ? res.layout : null; state.staves = staves;
    summary(harm ? colored.report : null, pitch);
    flow();
    $("save").disabled = false; status("");
    $("hint").textContent = harm ? "Click a Roman numeral to see why that chord was read that way." : "Pitch Color: every note name has its own color, the same in every key.";
    setTimeout(() => {      // read the colored score back and compare it with the original
      if (token !== state.token) return;
      try { const r = CK.verifyInvariants(state.score, CK.readScore(xml)); state.same = !!(r.notationIdentical && r.soundingIdentical && r.measuresIdentical && r.scoreEndIdentical); } catch (e) { state.same = false; }
      summary(harm ? colored.report : null, pitch);
    }, 60);
  }
  function summary(report, pitch) {
    const sc = state.score, res = state.result, harm = state.view === "harmony";
    const keys = res.keys.filter(k => k.end.gt(k.start));
    $("keys").innerHTML = harm ? (keys.length === 1 ? "Key: <b>" + esc(keyName(keys[0].key.name)) + "</b>" :
      "Keys: " + keys.slice(0, 14).map((k, i) => "<b>" + esc(keyName(k.key.name)) + "</b>" + (i ? " <span>(bar " + esc(barOf(sc, k.start)) + ")</span>" : "")).join(" → ") + (keys.length > 14 ? " …" : "")) : "";
    const spans = res.spans.filter(s => s.status !== "silent"), total = sc.scoreEnd.num() || 1;
    const unsure = spans.filter(s => !s.label || s.cueDegree).reduce((a, s) => a + s.end.num() - s.start.num(), 0) / total;
    const pitched = sc.notation.filter(r => !r.isRest).length, colored = harm ? report.nColored : pitch.n;
    const facts = [count(colored) + (colored === pitched ? " notes colored" : " of " + count(pitched) + " notes colored")];
    if (state.same !== null) facts.push(state.same ? "notes unchanged ✓" : "<b>the colored score differs from the original; do not use it</b>");
    if (harm) {
      facts.push(count(spans.length) + " chords");
      facts.push(Math.round(100 * unsure) + "% marked unsure" + (unsure > 0.5 ? " <b>(this music may lie outside what the page knows)</b>" : ""));
    }
    const lay = state.layout, touching = lay && !lay.error ? lay.labelsTouching + lay.labelsOverlapping + (state.staves ? state.staves.overlaps : 0) : 0;
    if (touching) facts.push(touching + " place" + (touching === 1 ? "" : "s") + " where print overlaps");
    $("facts").innerHTML = facts.map(f => "<span>" + f + "</span>").join("");
    if (harm) {
      const fams = state.lang.families.filter(f => report.families[f.id]);
      $("legend").innerHTML = fams.map(f => `<li><span class="dot" style="background:${esc(f.triad)}"></span>${esc(f.plain.en)}</li>`).join("");
    } else {
      $("legend").innerHTML = state.lang.pitch.names.map((n, i) => pitch.counts[i] ? `<li><span class="dot" style="background:${esc(state.lang.pitch.colors[i])}"></span>${esc(n)}</li>` : "").join("");
    }
  }

  // ------------------------------------------------------------------ why this chord
  function closeWhy() { const el = document.querySelector(".why"); if (el) el.remove(); }
  function describeNotes(input) {
    try {
      const p = CK.parseInput(input), f = x => ({ "-2": "𝄫", "-1": "♭", "0": "", "1": "♯", "2": "𝄪" }[String(x[1])] || "") + x[0];
      return "scale degrees " + p.feats.map(f).join(" ") + (p.bass ? ", with " + f(p.bass) + " in the bass" : "");
    } catch (e) { return ""; }
  }
  function why(i, evt) {
    closeWhy();
    const res = state.result, s = res.spans[i]; if (!s) return;
    const mode = s.key ? s.key.mode : null, text = l => pretty(CK.campaniaText(CK.labelParts(l, mode)));
    const fam = state.lang.families.find(f => f.id === s.family) || state.lang.unknown, ev = s.evidence || {};
    const lines = [];
    lines.push(`Bar ${esc(barOf(state.score, s.start))}, in ${esc(keyName(s.key ? s.key.name : ""))}.` + (s.input ? " The notes are " + esc(describeNotes(s.input)) + "." : ""));
    if (!s.label) lines.push("These notes, and anything close to them, are not among the chords it knows. So it gives no reading.");
    else {
      const top = Math.round((s.confidence || 0) * (s.support || 0));
      if (ev.level === "exact") lines.push(`For exactly these notes, experts wrote <span class="num">${esc(text(s.label))}</span> in ${count(top)} of ${count(s.support)} chords.`);
      else lines.push(`Exactly these notes are new to it. It judged from the closest notes it knows, where experts wrote <span class="num">${esc(text(s.label))}</span> in ${count(top)} of ${count(s.support)} chords.`);
      if (ev.byContext && ev.notesAlone) {
        let j = i - 1; while (j >= 0 && (res.spans[j].status === "silent" || !res.spans[j].label)) j -= 1;
        const before = j >= 0 && res.spans[j].key && s.key && res.spans[j].key.name === s.key.name ? text(res.spans[j].label) : null;
        lines.push(`From the notes alone it would be <span class="num">${esc(text(ev.notesAlone))}</span>. ` + (before ? `Coming after <span class="num">${esc(before)}</span>, ` : "In this chain of chords, ") + `<span class="num">${esc(text(s.label))}</span> is the more usual step.`);
      }
      const alts = (s.alternatives || []).slice(0, 3);
      if (alts.length) lines.push("Other readings of these notes: " + alts.map(a => `<span class="num">${esc(text(a.label))}</span> (${count(a.count)})`).join(", ") + ".");
      if (s.cueDegree) lines.push("Marked ? because the examples do not agree clearly enough on the color.");
    }
    const box = document.createElement("div"); box.className = "why"; box.setAttribute("role", "dialog");
    box.innerHTML = `<button class="x" type="button" aria-label="Close">×</button><h3><span class="dot" style="background:${esc(s.hex || fam.triad)}"></span><span class="num">${esc(s.label ? text(s.label) : "?")}</span> <span style="font-family:var(--ui);font-size:14px;font-weight:400;color:var(--ink-2)">${esc(fam.plain.en)}${s.label && s.seventh ? ", seventh chord" : ""}</span></h3>` + lines.map(l => "<p>" + l + "</p>").join("");
    const sheet = $("sheet"); sheet.appendChild(box);
    const sr = sheet.getBoundingClientRect();
    const x = Math.min(Math.max(8, evt.clientX - sr.left + sheet.scrollLeft - 40), sheet.scrollWidth - box.offsetWidth - 8);
    let y = evt.clientY - sr.top + sheet.scrollTop + 18;
    if (y + box.offsetHeight > sheet.scrollHeight - 6) y = Math.max(6, evt.clientY - sr.top + sheet.scrollTop - box.offsetHeight - 26);
    box.style.left = x + "px"; box.style.top = y + "px";
    box.querySelector(".x").addEventListener("click", closeWhy);
  }

  // ------------------------------------------------------------------ saving
  async function save() {
    if (!state.score) return;
    const harm = state.view === "harmony";
    const xml = harm ? harmony(true).xmlText : byPitch().xml;
    const stem = (String(state.meta.title || state.name).normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "score") + (harm ? "-color-key" : "-by-pitch");
    if (window.claude && typeof window.claude.use === "function") {      // inside a preview viewer, files are saved through the viewer
      try { const dl = await window.claude.use("downloads"); if (dl) { await dl.save({ filename: stem + ".musicxml.txt", data: xml }); status("Saved. Remove “.txt” from the name to open it in a notation program."); return; } } catch (e) { if (e && e.code === "declined") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" })); a.download = stem + ".musicxml";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    status("Saved " + stem + ".musicxml. It opens in MuseScore, Dorico, Sibelius or Finale.");
  }

  // ------------------------------------------------------------------ the wheels
  // Both wheels are drawn from language.json: the colors, the names, and (for harmony) the order and width of the wedges.
  const C = 260, f1 = n => n.toFixed(1);
  const polar = (r, a) => [C + r * Math.sin(a * Math.PI / 180), C - r * Math.cos(a * Math.PI / 180)];
  function wedge(r0, r1, a0, a1) {
    const p = polar(r1, a0), q = polar(r1, a1), u = polar(r0, a1), v = polar(r0, a0);
    return `M${f1(p[0])} ${f1(p[1])}A${r1} ${r1} 0 0 1 ${f1(q[0])} ${f1(q[1])}L${f1(u[0])} ${f1(u[1])}A${r0} ${r0} 0 0 0 ${f1(v[0])} ${f1(v[1])}Z`;
  }
  function inkOn(hex) {       // black or white, whichever reads better on this color
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.19 ? "#12161A" : "#FFFFFF";
  }
  const sentence = s => s.charAt(0).toUpperCase() + s.slice(1) + ".";
  function wire(host, show) {     // point, focus or tap a wedge; the last one tapped stays
    let pinned = 0;
    const on = i => { for (const g of host.querySelectorAll(".wedge")) g.classList.toggle("on", +g.dataset.k === i); show(i); };
    const of = e => { const g = e.target.closest ? e.target.closest(".wedge") : null; return g ? +g.dataset.k : -1; };
    host.addEventListener("pointerover", e => { const i = of(e); if (i >= 0) on(i); });
    host.addEventListener("focusin", e => { const i = of(e); if (i >= 0) on(i); });
    host.addEventListener("click", e => { const i = of(e); if (i >= 0) { pinned = i; on(i); } });
    host.addEventListener("keydown", e => { const i = of(e); if (i >= 0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pinned = i; on(i); } });
    host.addEventListener("pointerleave", () => on(pinned));
    host.addEventListener("focusout", e => { if (!host.contains(e.relatedTarget)) on(pinned); });
    on(pinned);
  }
  function harmonyWheel() {
    const lang = state.lang, by = new Map(lang.families.map(f => [f.id, f]));
    const order = lang.wheel.order.filter(o => by.has(o.id)), fams = order.map(o => by.get(o.id));
    let a = -order[0].span / 2, out = "";
    order.forEach((o, i) => {
      const f = fams[i], a0 = a, a1 = a + o.span, mid = (a0 + a1) / 2; a = a1;
      const t = polar(187, mid), s = polar(95, mid), push = polar(9, mid);
      const nums = f.numerals.length > 16 ? f.numerals.split(" · ") : [f.numerals], n = nums.length + 1, y0 = t[1] - (n - 1) * 8.5 + 5;
      out += `<g class="wedge" tabindex="0" role="button" data-k="${i}" aria-label="${esc(f.plain.en)}" style="--px:${f1(push[0] - C)}px;--py:${f1(push[1] - C)}px">`
        + `<path d="${wedge(122, 250, a0, a1)}" fill="${esc(f.triad)}"/><path d="${wedge(70, 118, a0, a1)}" fill="${esc(f.seventh)}"/>`
        + `<text x="${f1(t[0])}" y="${f1(y0)}" fill="${inkOn(f.triad)}" class="w-name">${esc(f.plain.en)}</text>`
        + nums.map((x, j) => `<text x="${f1(t[0])}" y="${f1(y0 + 17 * (j + 1))}" fill="${inkOn(f.triad)}" class="w-num">${esc(x)}</text>`).join("")
        + `<text x="${f1(s[0])}" y="${f1(s[1] + 5)}" fill="${inkOn(f.seventh)}" class="w-num">7</text></g>`;
    });
    const a1 = 328, end = polar(40, a1), rad = a1 * Math.PI / 180, tx = Math.cos(rad), ty = Math.sin(rad), nx = Math.sin(rad), ny = -Math.cos(rad);      // the usual motion runs clockwise and comes home at the top
    const arrow = `<g class="w-turn" fill="none"><path d="M${f1(polar(40, 32)[0])} ${f1(polar(40, 32)[1])}A40 40 0 1 1 ${f1(end[0])} ${f1(end[1])}"/>`
      + `<path d="M${f1(end[0] - 11 * tx + 7 * nx)} ${f1(end[1] - 11 * ty + 7 * ny)}L${f1(end[0])} ${f1(end[1])}L${f1(end[0] - 11 * tx - 7 * nx)} ${f1(end[1] - 11 * ty - 7 * ny)}"/></g>`;
    $("harmonyWheel").innerHTML = `<svg viewBox="0 0 520 520" role="group" aria-label="Harmony Color wheel">${out}${arrow}</svg>`;
    $("harmonyList").innerHTML = fams.map(f => `<li>${esc(f.plain.en)}, ${esc(f.numerals)}. ${esc(sentence(f.short.en))}</li>`).join("");
    wire($("harmonyWheel"), i => { const f = fams[i];
      $("harmonyCap").innerHTML = `<p class="cap-name"><span class="chip" style="background:${esc(f.triad)}"></span><span class="chip" style="background:${esc(f.seventh)}"></span><b>${esc(f.plain.en)}</b> <span class="num">${esc(f.numerals)}</span></p><p>${esc(sentence(f.short.en))}</p>`; });
  }
  function pitchWheel() {
    const P = state.lang.pitch, n = P.names.length, w = 360 / n;
    const out = P.names.map((name, i) => {
      const a0 = (i - 0.5) * w, t = polar(190, i * w), lines = name.split(" / "), y0 = t[1] - (lines.length - 1) * 11 + 8;
      return `<g class="wedge" tabindex="0" role="button" data-k="${i}" aria-label="${esc(name)}" style="--px:${f1(polar(9, i * w)[0] - C)}px;--py:${f1(polar(9, i * w)[1] - C)}px"><path d="${wedge(126, 250, a0, a0 + w)}" fill="${esc(P.colors[i])}"/>`
        + lines.map((x, j) => `<text x="${f1(t[0])}" y="${f1(y0 + 22 * j)}" fill="${inkOn(P.colors[i])}" class="w-note">${esc(x)}</text>`).join("") + `</g>`;
    }).join("");
    $("pitchWheel").innerHTML = `<svg viewBox="0 0 520 520" role="group" aria-label="Pitch Color wheel">${out}<circle cx="${C}" cy="${C}" r="84" class="w-hub" id="pitchHub"/><text x="${C}" y="${C + 15}" class="w-big" id="pitchBig"></text></svg>`;
    $("pitchList").innerHTML = P.names.map(x => `<li>${esc(x)}</li>`).join("");
    wire($("pitchWheel"), i => { $("pitchBig").textContent = P.names[i]; $("pitchBig").style.fill = inkOn(P.colors[i]); $("pitchHub").style.fill = P.colors[i]; });
  }

  // ------------------------------------------------------------------ the river
  // The piece from first bar to last as a band of its own colors. It moves like water, and busier music makes rougher water:
  // each stretch is as choppy as its notes per quarter note and its chord changes. With reduced motion it is drawn once, still.
  const rivers = [];
  function makeRiver(canvas, opt) {
    const R = { canvas, opt, src: null, prof: null, energy: 0.3, grain: 40, seen: true, buf: document.createElement("canvas") };
    R.set = (src, prof, energy, grain) => { R.src = src; R.prof = prof; R.energy = energy; R.grain = grain || 40; R.paint(still.matches ? 0 : performance.now() / 1000); };
    R.paint = t => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
      if (!W || !H) return;
      if (canvas.width !== W || canvas.height !== H) { canvas.width = R.buf.width = W; canvas.height = R.buf.height = H; }
      const b = R.buf.getContext("2d"), c = canvas.getContext("2d"), e = R.energy, src = R.src;
      b.clearRect(0, 0, W, H); c.clearRect(0, 0, W, H);
      if (!src) return;
      // 1. the colors, in thin rows that sway against each other
      const m = Math.round(opt.margin * dpr), rh = Math.max(2, Math.round(2 * dpr)), sway = Math.min((1 + 5 * e) * dpr * opt.scale, 0.35 * (W - 2 * m) / R.grain);     // never wider than a short chord
      for (let y = 0; y < H; y += rh) {
        const v = y / H, dx = sway * (0.65 * Math.sin(v * 5 + t * (0.5 + e)) + 0.35 * Math.sin(v * 12 - t * (0.8 + 1.4 * e)));
        b.drawImage(src, 0, Math.min(src.height - 1, Math.floor(v * src.height)), src.width, 1, m + dx, y, W - 2 * m, rh);
      }
      // 2. the surface: a slow swell where the music is calm, short waves where it is busy
      const cw = Math.max(2, Math.round(1.5 * dpr)), pad = H * opt.pad, n = R.prof ? R.prof.length : 0, fq = opt.freq;
      for (let x = 0; x < W; x += cw) {
        const u = x / W, at = u * (n - 1), i0 = Math.floor(at), k = n ? R.prof[i0] + (R.prof[Math.min(n - 1, i0 + 1)] - R.prof[i0]) * (at - i0) : e;
        const amp = pad * (0.22 + 0.78 * k), calm = 1 - 0.65 * k;
        const chop = 0.6 * Math.sin(u * 43 * fq - t * (1.5 + 2.6 * e)) + 0.4 * Math.sin(u * 97 * fq - t * (2.2 + 3 * e) + 1.3);
        const chop2 = 0.6 * Math.sin(u * 37 * fq - t * (1.3 + 2.4 * e) + 2) + 0.4 * Math.sin(u * 89 * fq - t * (2 + 3.2 * e) + 0.4);
        const top = pad - amp * (calm * Math.sin(u * 7 * fq - t * (0.45 + 0.8 * e)) + k * chop) * 0.9;
        const bot = H - pad + amp * (calm * Math.sin(u * 6 * fq - t * (0.4 + 0.7 * e) + 2.1) + k * chop2) * 0.9;
        c.drawImage(R.buf, x, 0, cw, H, x, top, cw, bot - top);
      }
      // 3. light on the water, and the current
      c.globalCompositeOperation = "source-atop";
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "rgba(255,255,255,.20)"); g.addColorStop(0.45, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(0,0,0,.16)");
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      if (opt.streaks) {
        const fr = x => x - Math.floor(x); c.lineCap = "round";
        for (let i = 0, count = Math.round(5 + 12 * e); i < count; i++) {
          const s = fr(i * 0.371 + 0.2), x0 = (fr(i * 0.618 + t * (0.012 + 0.05 * e) * (0.6 + s)) * 1.3 - 0.15) * W, len = (0.03 + 0.07 * s) * W, y0 = H * (0.26 + 0.48 * fr(i * 0.754 + 0.1));
          c.strokeStyle = `rgba(255,255,255,${(0.10 + 0.16 * s).toFixed(2)})`; c.lineWidth = (1 + 1.4 * s) * dpr; c.beginPath();
          for (let j = 0; j <= 8; j++) { const xx = x0 + len * j / 8, yy = y0 + Math.sin(xx / W * 30 - t * 2 + i) * H * 0.035 * (0.4 + e); if (j) c.lineTo(xx, yy); else c.moveTo(xx, yy); }
          c.stroke();
        }
      }
      c.globalCompositeOperation = "source-over";
    };
    if ("IntersectionObserver" in window) new IntersectionObserver(es => { R.seen = es[es.length - 1].isIntersecting; }).observe(canvas);
    rivers.push(R); return R;
  }
  let lastFrame = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (still.matches || document.hidden || now - lastFrame < 33) return;
    lastFrame = now;
    for (const R of rivers) if (R.seen && R.src) R.paint(now / 1000);
  }
  const river = makeRiver($("riverCanvas"), { margin: 10, pad: 0.24, scale: 1, freq: 1, streaks: true });
  const ribbon = makeRiver($("ribbon"), { margin: 4, pad: 0.3, scale: 0.5, freq: 0.3, streaks: false });
  requestAnimationFrame(frame);

  function ribbonAtRest() {     // before any piece is read: the harmony colors in wheel order
    const src = document.createElement("canvas"), by = new Map(state.lang.families.map(f => [f.id, f])), order = state.lang.wheel.order.filter(o => by.has(o.id));
    src.width = 360; src.height = 1; const g = src.getContext("2d"); let x = 0;
    for (const o of order) { g.fillStyle = by.get(o.id).triad; g.fillRect(x, 0, o.span, 1); x += o.span; }
    ribbon.set(src, null, 0.3);
  }
  function flow() {             // called after each drawing of the score
    const sc = state.score, total = sc.scoreEnd.num() || 1, harm = state.view === "harmony", lang = state.lang;
    const notes = sc.notation.filter(r => !r.isRest && !r.isGrace && r.sounding && r.tie !== "stop" && r.tie !== "continue");
    const spans = state.result.spans.filter(s => s.status !== "silent");
    // colors over time
    const src = document.createElement("canvas"); src.width = 2048; src.height = harm ? 1 : 48;
    const g = src.getContext("2d"), X = t => t / total * src.width;
    g.fillStyle = "rgba(128,134,140,.3)"; g.fillRect(0, 0, src.width, src.height);        // silence
    if (harm) {
      for (const s of spans) { const a = X(s.start.num()); g.fillStyle = s.hex || lang.unknown.triad; g.fillRect(a, 0, Math.max(1, X(s.end.num()) - a), 1); }
    } else {      // each slice of time shows the note names that begin in it, C at the top, in the share they take
      const n = 256, bins = Array.from({ length: n }, () => new Array(12).fill(0)), w = src.width / n;
      for (const r of notes) bins[Math.min(n - 1, Math.floor(r.onset.num() / total * n))][r.sounding.pc] += 1;
      let held = null;
      bins.forEach((bin, i) => {
        const sum = bin.reduce((a, x) => a + x, 0); if (sum) held = bin; if (!held) return;
        const tot = held.reduce((a, x) => a + x, 0); let y = 0;
        held.forEach((x, pc) => { if (!x) return; const h = x / tot * src.height; g.fillStyle = lang.pitch.colors[pc]; g.fillRect(i * w, y, w + 0.5, h + 0.5); y += h; });
      });
    }
    // how busy each stretch is
    const n = 96, per = total / n, dens = new Array(n).fill(0), turn = new Array(n).fill(0), bin = t => Math.min(n - 1, Math.floor(t / total * n));
    for (const r of notes) dens[bin(r.onset.num())] += 1;
    for (const s of spans) turn[bin(s.start.num())] += 1;
    let prof = dens.map((d, i) => Math.min(1, 0.6 * Math.min(1, d / per / 10) + 0.4 * Math.min(1, turn[i] / per)));
    for (let pass = 0; pass < 2; pass++) prof = prof.map((v, i) => (prof[Math.max(0, i - 1)] + 2 * v + prof[Math.min(n - 1, i + 1)]) / 4);
    const energy = prof.reduce((a, v) => a + v, 0) / n;
    state.flow = { notesPerQuarter: notes.length / total, chordsPerBar: spans.length / (sc.measures.length || 1), energy };
    const grain = harm ? Math.max(20, spans.length) : 64;
    river.set(src, prof, energy, grain); ribbon.set(src, prof, energy, grain);
    riverCaption(null);
    $("river").setAttribute("aria-valuemax", String(sc.measures.length));
  }
  // the river is also a way to move through the score
  function riverCaption(mi) {
    const sc = state.score, f = state.flow, el = $("riverCap"), mark = $("riverMark"), box = $("river");
    if (mi === null || !sc) {
      mark.hidden = true;
      el.textContent = f ? "First bar to last. Busier music makes rougher water: " + f.notesPerQuarter.toFixed(1) + " notes per quarter note, " + f.chordsPerBar.toFixed(1) + " chords per bar. Click the river to go to a bar." : "";
      return;
    }
    const m = sc.measures[mi], total = sc.scoreEnd.num() || 1, t = m.start.num();
    let text = "Bar " + (m.printedNumber || String(m.index));
    if (state.view === "harmony") {
      const s = state.result.spans.find(x => x.status !== "silent" && x.end.num() > t + 1e-9);
      if (s) { const fam = state.lang.families.find(x => x.id === s.family) || state.lang.unknown;
        text += " · " + (s.label ? pretty(CK.campaniaText(CK.labelParts(s.label, s.key ? s.key.mode : null))) : "?") + " · " + fam.plain.en; }
    }
    el.textContent = text;
    mark.hidden = false; mark.style.left = (10 + (box.clientWidth - 20) * t / total) + "px";
    box.setAttribute("aria-valuenow", String(mi + 1)); box.setAttribute("aria-valuetext", text);
  }
  function barAtX(clientX) {
    const r = $("river").getBoundingClientRect(), u = Math.min(1, Math.max(0, (clientX - r.left - 10) / (r.width - 20)));
    const t = u * (state.score.scoreEnd.num() || 1); let lo = 0, hi = state.score.measures.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (state.score.measures[mid].start.num() <= t) lo = mid + 1; else hi = mid; }
    return Math.max(0, lo - 1);
  }
  function clearHere() { const el = document.querySelector(".here"); if (el) el.remove(); }
  function goToBar(mi) {
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
  (function () {
    const box = $("river"); let at = 0;
    box.addEventListener("pointermove", e => { if (state.score) { at = barAtX(e.clientX); riverCaption(at); } });
    box.addEventListener("pointerleave", () => { if (document.activeElement !== box) riverCaption(null); });
    box.addEventListener("blur", () => riverCaption(null));
    box.addEventListener("click", e => { if (state.score) { at = barAtX(e.clientX); riverCaption(at); goToBar(at); } });
    box.addEventListener("keydown", e => {
      if (!state.score) return; const last = state.score.measures.length - 1;
      const to = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, PageUp: at + 8, PageDown: at - 8, Home: 0, End: last }[e.key];
      if (to !== undefined) { e.preventDefault(); at = Math.min(last, Math.max(0, to)); riverCaption(at); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); riverCaption(at); goToBar(at); }
    });
    window.addEventListener("resize", () => { if (still.matches) for (const R of rivers) R.paint(0); });
  })();

  // ------------------------------------------------------------------ start
  async function boot() {
    const get = async p => (await fetch(p)).json();
    try {
      const [lang, dict, prog, examples, about] = await Promise.all([get("data/language.json"), get("data/dictionary.json"), get("data/progression.json"), get("examples/examples.json"), get("data/about.json")]);
      state.lang = lang; state.dict = { entries: dict.entries, hash: dict.hash, partitions: "train+validation" };
      state.prog = { model: new CK.ProgressionModel(prog), weight: prog.selected.weight, kappa: prog.selected.kappa, prior: prog.selected.prior };
      state.examples = examples; state.ready = true;
      $("foot").textContent = "Version " + about.version + " · " + about.date;
      $("tries").insertAdjacentHTML("beforeend", examples.map(e => `<button class="link" type="button" data-ex="${esc(e.id)}">${esc(e.short)}</button>`).join(""));
      const root = document.documentElement.style;       // the page takes its few colors from the same data as the score
      for (const f of lang.families) { root.setProperty("--c-" + f.id, f.triad); root.setProperty("--c-" + f.id + "-7", f.seventh); }
      if (window.ColorKeyOMR) { $("dropTitle").textContent = "Drop a score here"; $("dropSub").textContent = "MusicXML (.musicxml, .xml, .mxl), or a PDF or a photo of printed music. It stays on your device."; }
      harmonyWheel(); pitchWheel(); ribbonAtRest();
    } catch (err) { console.error(err); $("result").hidden = false; status("The page could not load its data. Reload to try again.", "error"); return; }
    const q = new URLSearchParams(location.search);
    if (q.get("full")) $("sheet").style.overflow = "visible";
    if (q.get("src")) { try { const r = await fetch(q.get("src")); await openFile(new File([await r.blob()], q.get("src").split("/").pop())); } catch (e) { console.error(e); } }
    else await openExample(state.examples.some(e => e.id === q.get("ex")) ? q.get("ex") : state.examples[0].id);     // open on a short piece, so the first look shows what the page does
    if (q.get("view") === "pitch") { state.view = "pitch"; setView(); await draw(); }
    const at = location.hash === "#reference" ? $("colors") : /^#[a-z]+$/.test(location.hash) ? document.querySelector(location.hash) : null;
    if (at && at.id !== "top") at.scrollIntoView();      // the score above has just taken its room
  }
  function setView() { for (const b of document.querySelectorAll(".seg button")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view)); }

  $("file").addEventListener("change", e => { const f = e.target.files && e.target.files[0]; if (f && state.ready) openAny(f); e.target.value = ""; });
  $("drop").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  ["dragenter", "dragover"].forEach(ev => window.addEventListener(ev, e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.add("dragging"); }));
  window.addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
  window.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); document.body.classList.remove("dragging"); const f = e.dataTransfer.files[0]; if (f && state.ready) openAny(f); });
  $("tries").addEventListener("click", e => { const b = e.target.closest("button[data-ex]"); if (b && state.ready) openExample(b.dataset.ex); });
  document.querySelector(".seg").addEventListener("click", e => { const b = e.target.closest("button[data-view]"); if (!b || b.dataset.view === state.view || !state.score) return; state.view = b.dataset.view; setView(); draw(); });
  $("save").addEventListener("click", save);
  $("print").addEventListener("click", () => window.print());
  $("score").addEventListener("click", e => { const el = e.target.closest ? e.target.closest("text[data-i]") : null; if (el) { e.stopPropagation(); why(parseInt(el.getAttribute("data-i"), 10), e); } });
  document.addEventListener("click", e => { if (!e.target.closest(".why") && !e.target.closest("text[data-i]")) closeWhy(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeWhy(); });
  let timer = null, lastW = 0;
  window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => { const w = $("score").clientWidth; if (state.score && Math.abs(w - lastW) > 24) { lastW = w; draw(); } }, 250); });
  window.ColorKeyPage = { state, openFile };
  boot();
})();
