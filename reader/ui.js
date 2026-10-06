/* Printed music on the page: a PDF, a scan or a photo is read on this device and its notes are colored where they stand.
   This small file is always loaded; the reader itself, its network and the PDF library are fetched only when a picture is dropped. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SEMIS = [0, 2, 4, 5, 7, 9, 11], LETTERS = "CDEFGAB";
  const ACC = { "1": "♯", "-1": "♭", "2": "𝄪", "-2": "𝄫", "0": "" };
  const state = { net: null, pages: [], names: false, file: "", job: null, lang: null, token: 0, view: "pitch", harmony: null, beats: null, meterTpl: null };
  const mq = q => (window.matchMedia ? window.matchMedia(q).matches : false);
  const STOPPED = new Error("stopped");                              // a read that was given up for another file

  const lang = () => (window.ColorKeyPage && window.ColorKeyPage.state.lang) || state.lang;      // the colors in use now, not the ones first seen

  const loaded = {};
  function script(src) {
    if (!loaded[src]) loaded[src] = new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error("could not load " + src)); document.head.appendChild(s); });
    return loaded[src];
  }
  async function ready(needPdf) {
    if (!state.lang) state.lang = (window.ColorKeyPage && window.ColorKeyPage.state.lang) || await (await fetch("data/language.json")).json();
    await script("reader/reader.js");
    if (!state.net) {
      try {                                                          // the runtime's program is stored compressed; unpack it here
        await script("vendor/ort/ort.wasm.min.js");
        const packed = await fetch("vendor/ort/ort-wasm-simd.wasmz");
        if (!packed.ok) throw new Error("runtime not found");
        const program = await new Response(packed.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        window.ort.env.wasm.wasmPaths = { "ort-wasm-simd.wasm": URL.createObjectURL(new Blob([program], { type: "application/wasm" })) };
      } catch (e) { window.ort = undefined; /* the plain arithmetic still works */ }
      state.net = await window.ColorKeyReader.loadNet("reader/", {});
    }
    if (needPdf) { await script("vendor/pdf.min.js"); window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; }
  }

  function frame(title) {
    const box = $("omr");
    box.hidden = false; $("result").hidden = true;
    const hint = ($("omrHintText") || {}).textContent || "Reading printed music is new here. It reads noteheads, clefs, key signatures, accidentals and barlines, staff by staff, and it can be wrong, most often on faint or crowded pages. Check it against the page.";
    box.innerHTML = `<section class="read">
      <div class="stage-bar pane">
        <div class="head">
          <div><h2 class="piece">${esc(title)}</h2><p class="by" id="omrBy">Read from the printed page</p></div>
          <div class="tools">
            <div class="seg" role="group" aria-label="What the colors show">
              <button type="button" data-omr="pitch" aria-pressed="true">Pitch Color</button>
              <button type="button" data-omr="harmony" aria-pressed="false">Harmony Color</button>
            </div>
            <button class="btn" id="omrNames" type="button" aria-pressed="false">Note names</button>
            <button class="btn solid" id="omrSave" type="button" disabled>Download colored pages</button>
          </div>
        </div>
        <div class="meta"><p class="facts" id="omrFacts"></p><p class="omr-beats" id="omrBeats" hidden></p></div>
        <div class="under"><ul class="legend" id="omrLegend"></ul><p class="status" id="omrStatus" role="status"></p></div>
        <p class="omr-say" id="omrSay">${mq("(hover: none)") ? "Tap" : "Point at"} a note to see how it was read.</p>
      </div>
      <div id="omrPages"></div>
      <p class="hint">${esc(hint)}</p>
    </section>`;
    $("omrNames").addEventListener("click", () => { state.names = !state.names; $("omrNames").setAttribute("aria-pressed", String(state.names)); state.pages.forEach(paint); });
    $("omrSave").addEventListener("click", save);
    box.querySelector(".seg").addEventListener("click", e => {
      const b = e.target.closest("button[data-omr]"); if (!b || b.dataset.omr === state.view || state.job) return;
      setView(b.dataset.omr);
    });
    $("omrBeats").addEventListener("click", e => {
      const b = e.target.closest("button[data-beats]"); if (!b || state.job) return;
      state.beats = +b.dataset.beats || null; state.harmony = null; setView("harmony");
    });
    box.scrollIntoView({ block: "start", behavior: mq("(prefers-reduced-motion: reduce)") ? "auto" : "smooth" });
  }

  const pcOf = n => (((SEMIS[n.letter] + n.alter) % 12) + 12) % 12;
  function paint(pg) {
    if (state.view === "harmony" && state.harmony && state.harmony.ok) return paintHarmony(pg);
    const cv = pg.canvas, g = cv.getContext("2d"), colors = lang().pitch.colors;
    g.globalCompositeOperation = "source-over"; g.drawImage(pg.image, 0, 0);
    pg.result.notes.forEach(n => {                                    // "screen" turns black ink into the color and leaves white paper white
      g.globalCompositeOperation = "screen"; g.fillStyle = colors[pcOf(n)];
      g.beginPath(); g.ellipse(n.x, n.y, n.space * 0.86, n.space * 0.62, -0.35, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = "source-over";
    if (state.names) {
      pg.result.notes.forEach(n => {
        const t = LETTERS[n.letter] + ACC[String(n.alter)], size = Math.max(9, n.space * 0.95);
        g.font = `600 ${size}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
        const y = n.y - n.space * 1.25;
        g.lineWidth = Math.max(2, size / 4); g.strokeStyle = "rgba(255,255,255,.92)"; g.strokeText(t, n.x, y);
        g.fillStyle = colors[pcOf(n)]; g.fillText(t, n.x, y);
      });
    }
  }

  /* ---------- Harmony Color from the page: a draft made from where the notes stand (reader/harmony.js) ---------- */
  const famOf = id => lang().families.find(f => f.id === id) || lang().unknown;
  const famName = id => { const f = famOf(id); return (f.plain && f.plain.en) || (f.term && f.term.en) || id; };
  const hexOfHead = h => { const hr = state.harmony, sp = h.span >= 0 ? hr.spans[h.span] : null, f = famOf(h.family); return (sp && sp.seventh && sp.family === h.family) ? f.seventh : f.triad; };
  async function harmonyRead() {
    await script("reader/harmony.js");
    const H = window.ColorKeyReaderHarmony, R = window.ColorKeyReader, P = window.ColorKeyPage && window.ColorKeyPage.state;
    if (!window.ColorKey || !P || !P.dict) throw new Error("the analyzer is not on this page");
    if (state.meterTpl === null) { try { state.meterTpl = H.loadMeter(await (await fetch("reader/meter.json")).json()); } catch (e) { state.meterTpl = false; } }
    let image = null;
    if (state.meterTpl && state.pages.length) {                       // the first page, for the time signature
      const pg = state.pages[0], img = pg.image.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, pg.image.width, pg.image.height);
      image = { gray: R.toGray(img.data, img.width, img.height), w: img.width, h: img.height };
    }
    const env = { dict: P.dict, prog: P.prog ? { model: P.prog.model, weight: P.prog.weight, kappa: P.prog.kappa, prior: P.prog.prior } : null, lang: lang() };
    return H.read(state.pages.map(p => p.result), env, { beats: state.beats || null, image, tpl: state.meterTpl || null });
  }
  async function setView(view) {
    const status = t => { if ($("omrStatus")) $("omrStatus").textContent = t; };
    if (view === "harmony" && !state.pages.some(p => p.result.notes.length)) return;      // nothing has been read yet
    if (view === "harmony" && !state.harmony) {
      status("Reading the harmony from the layout of the page");
      await new Promise(r => setTimeout(r, 20));
      try { state.harmony = await harmonyRead(); } catch (e) { console.error(e); state.harmony = { ok: false, problem: "the harmony could not be read from this page" }; }
      if (!state.harmony.ok) { status("Harmony Color could not be made from this page: " + state.harmony.problem + ". Pitch Color is still here."); state.harmony = null; return; }
    }
    state.view = view;
    for (const b of document.querySelectorAll("#omr .seg button")) b.setAttribute("aria-pressed", String(b.dataset.omr === view));
    status(view === "harmony" ? "A draft. The page sees where the notes stand, not how long they last." : "");
    state.pages.forEach(paint); summary();
    if ($("omrSay")) $("omrSay").textContent = (mq("(hover: none)") ? "Tap" : "Point at") + (view === "harmony" ? " a note to see the chord it was read in." : " a note to see how it was read.");
  }
  function paintHarmony(pg) {
    const cv = pg.canvas, g = cv.getContext("2d"), hr = state.harmony, pi = state.pages.indexOf(pg);
    g.globalCompositeOperation = "source-over"; g.drawImage(pg.image, 0, 0);
    const mine = hr.heads.filter(h => h.page === pi);
    mine.forEach(h => {
      g.globalCompositeOperation = "screen"; g.fillStyle = hexOfHead(h);
      g.beginPath(); g.ellipse(h.x, h.y, h.space * 0.86, h.space * 0.62, -0.35, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = "source-over";
    if (state.names) mine.forEach(h => {
      const n = h.note, t = LETTERS[n.letter] + ACC[String(n.alter)], size = Math.max(9, n.space * 0.95), y = n.y - n.space * 1.25;
      g.font = `600 ${size}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = Math.max(2, size / 4); g.strokeStyle = "rgba(255,255,255,.92)"; g.strokeText(t, n.x, y); g.fillStyle = hexOfHead(h); g.fillText(t, n.x, y);
    });
    // the chord names, under each system where the chord begins; a name that would run into the one before goes one line lower
    const lowest = new Map();                                         // system -> the lowest notehead on this page
    mine.forEach(h => { const sys = hr.layout.bars[h.bar].sys; lowest.set(sys, Math.max(lowest.get(sys) || 0, h.y)); });
    const right = new Map();
    hr.labels.filter(l => l.page === pi).sort((a, b) => a.sys.system - b.sys.system || a.x - b.x).forEach(l => {
      const sys = l.sys, sp = sys.space, last = sys.staves[sys.staves.length - 1], size = Math.max(12, sp * 1.9);
      const base = Math.max(last.top + 4 * sp + 3.4 * sp, (lowest.get(sys) || 0) + 2.4 * sp);
      const fam = l.span >= 0 ? hr.spans[l.span] : null, hex = fam && fam.family ? (fam.seventh ? famOf(fam.family).seventh : famOf(fam.family).triad) : lang().unknown.triad;
      const text = (l.prefix ? l.prefix + " " : "") + l.text + (l.unsure ? " ?" : "");
      g.font = `700 ${size}px Georgia, "Times New Roman", serif`; g.textAlign = "left"; g.textBaseline = "alphabetic";
      const w = g.measureText(text).width, x = l.x - sp * 0.6, used = right.get(sys) || [-1e9, -1e9];
      const line = x > used[0] + sp * 0.5 ? 0 : (x > used[1] + sp * 0.5 ? 1 : 0);
      used[line] = x + w; right.set(sys, used);
      const y = base + line * size * 1.15;
      g.lineWidth = Math.max(3, size / 3.2); g.lineJoin = "round"; g.strokeStyle = "rgba(255,255,255,.94)"; g.strokeText(text, x, y);
      g.fillStyle = hex; g.fillText(text, x, y);
    });
  }
  function sayHarmony(pg, x, y, reach) {
    const hr = state.harmony, pi = state.pages.indexOf(pg); let best = null, bd = 1e9;
    hr.heads.forEach(h => { if (h.page !== pi) return; const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } });
    if (!best || bd > Math.max(best.space * 1.6, reach)) return null;
    const n = best.note, name = LETTERS[n.letter] + ACC[String(n.alter)] + n.octave, sp = best.span >= 0 ? hr.spans[best.span] : null;
    if (!sp || !sp.label) return { hex: hexOfHead(best), text: `${name}: no chord was read here (bar ${best.bar + 1}).` };
    const fig = window.ColorKey.prettyAccidentals(sp.figure || "?").replace(" (cad)", " (cadential six-four)");
    return { hex: hexOfHead(best), text: `${fig}${sp.cueDegree ? " (unsure)" : ""}: ${famName(best.family)}${sp.seventh ? ", seventh chord" : ""}, in ${sp.key ? sp.key.name : "no key"}, bar ${best.bar + 1}. ${name} sounds while this chord lasts.` };
  }

  const CLEF = { G: "treble clef", F: "bass clef", C: "C clef" };
  function keyWords(f) { return f === 0 ? "no sharps or flats in the key signature" : Math.abs(f) + (f > 0 ? " sharp" : " flat") + (Math.abs(f) > 1 ? "s" : "") + " in the key signature"; }
  function say(pg, n) {
    const st = pg.result.staves.find(s => s.index === n.staff) || {};
    const clefs = (st.reasons || []).filter(r => r.what === "clef" && r.col <= n.col), keys = (st.reasons || []).filter(r => r.what === "key" && r.col <= n.col);
    const clef = clefs.length ? CLEF[clefs[clefs.length - 1].clef] : (st.clef ? CLEF[["G", "F", "C"][st.clef.c - 8]] : "the clef from the line above");
    const line = n.step % 2 === 0 ? (n.step >= 0 && n.step <= 8 ? "line " + (5 - n.step / 2) + " (from the bottom)" : "a ledger line") : (n.step > 0 && n.step < 8 ? "space " + ((9 - n.step) / 2) + " (from the bottom)" : "a space outside the staff");
    const name = LETTERS[n.letter] + ACC[String(n.alter)] + n.octave;
    const why = n.why === "printed" ? "the accidental printed in front of it" : n.why === "bar" ? "an accidental earlier in the same bar, which still holds" : n.why === "key" ? "the key signature" : "nothing alters it";
    const key = keys.length ? keyWords(keys[keys.length - 1].fifths) : (st.key != null ? keyWords(st.key) : "");
    return `${name}: a notehead on ${line}, ${clef}${key ? ", " + key : ""}. ${n.alter ? (n.alter > 0 ? "Sharp" : "Flat") : "Natural"} because of ${why}.`.replace("because of nothing alters it", "because nothing alters it");
  }

  function addPage(image, result, num) {
    const wrap = document.createElement("figure"); wrap.className = "omr-page";
    const cv = document.createElement("canvas"); cv.width = image.width; cv.height = image.height;
    wrap.appendChild(cv);
    const cap = document.createElement("figcaption"); cap.textContent = `Page ${num}: ${result.staves.length} staves, ${result.notes.length} notes` + (result.problem ? " (" + result.problem + ")" : "");
    wrap.appendChild(cap);
    cv.setAttribute("role", "img"); cv.setAttribute("aria-label", "The printed page with its notes colored by pitch. " + cap.textContent);
    $("omrPages").appendChild(wrap);
    const pg = { canvas: cv, image, result, num };
    const near = (e, finger) => {                                     // the note nearest to the pointer; a finger reaches further than a pointer (22 px on the screen)
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
      if (state.view === "harmony" && state.harmony && state.harmony.ok) {
        const s = sayHarmony(pg, x, y, finger ? 22 * cv.width / r.width : 0);
        if (s) $("omrSay").innerHTML = '<span class="dot" style="background:' + esc(s.hex) + '"></span>' + esc(s.text);
        return;
      }
      let best = null, bd = 1e9;
      result.notes.forEach(n => { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } });
      if (best && bd < Math.max(best.space * 1.6, finger ? 22 * cv.width / r.width : 0)) $("omrSay").innerHTML = '<span class="dot" style="background:' + esc(lang().pitch.colors[pcOf(best)]) + '"></span>' + esc(say(pg, best));
    };
    cv.addEventListener("mousemove", e => near(e, false));
    cv.addEventListener("click", e => near(e, e.pointerType === "touch" || mq("(hover: none)")));
    state.pages.push(pg); paint(pg);
    return pg;
  }

  function summaryHarmony() {
    const hr = state.harmony, nf = n => n.toLocaleString("en-US"), count = {};
    hr.heads.forEach(h => { count[h.family] = (count[h.family] || 0) + 1; });
    const keys = hr.keys.filter(k => k.name).map((k, i) => i ? `${esc(k.name)} (bar ${k.bar})` : `<b>${esc(k.name)}</b>`).join(" → ");
    $("omrFacts").innerHTML = `<span>Key${hr.keys.length > 1 ? "s" : ""}: ${keys || "none found"}</span><span><b>${nf(hr.bars)}</b> bars</span><span><b>${nf(hr.chords)}</b> chords</span><span><b>${Math.round(100 * hr.unsure)}%</b> marked unsure</span>`;
    const fams = lang().families.filter(f => count[f.id]);
    $("omrLegend").innerHTML = fams.map(f => `<li><span class="chip"><span class="dot" style="background:${esc(f.triad)}"></span>${esc(famName(f.id))}</span></li>`).join("");
    const how = hr.chosen === "read" ? `read from the time signature (${esc(hr.meter.name)})` : hr.chosen === "set" ? "set by you" : "judged from the layout, no time signature found";
    $("omrBeats").hidden = false;
    $("omrBeats").innerHTML = `<span>Beats in a bar</span> ` + [2, 3, 4, 6].map(b => `<button type="button" data-beats="${b}" aria-pressed="${b === hr.beats}">${b}</button>`).join("") + ` <span class="how">${how}</span>` + (state.beats ? ` <button type="button" data-beats="0" class="auto">let the page choose</button>` : "");
    const top = fams.slice().sort((a, b) => count[b.id] - count[a.id])[0];
    if (top && window.ColorKeyPage && window.ColorKeyPage.field) window.ColorKeyPage.field.fromPiece(top.triad);
  }
  function summary() {
    if (state.view === "harmony" && state.harmony && state.harmony.ok) return summaryHarmony();
    if ($("omrBeats")) $("omrBeats").hidden = true;
    const counts = new Array(12).fill(0); let notes = 0, staves = 0;
    state.pages.forEach(p => { staves += p.result.staves.length; p.result.notes.forEach(n => { counts[pcOf(n)]++; notes++; }); });
    const nf = n => n.toLocaleString("en-US");
    $("omrFacts").innerHTML = `<span><b>${nf(state.pages.length)}</b> page${state.pages.length === 1 ? "" : "s"}</span><span><b>${nf(staves)}</b> staves</span><span><b>${nf(notes)}</b> notes read</span>`;
    const P = lang().pitch;
    $("omrLegend").innerHTML = P.names.map((n, i) => counts[i] ? `<li><span class="chip"><span class="dot" style="background:${esc(P.colors[i])}"></span>${esc(n)}</span></li>` : "").join("");
    const top = counts.indexOf(Math.max(...counts));         // the backdrop takes the page's most frequent note color
    if (notes && window.ColorKeyPage && window.ColorKeyPage.field) window.ColorKeyPage.field.fromPiece(P.colors[top]);
  }

  function canvasOf(src, maxSide) {
    const f = Math.min(1, maxSide / Math.max(src.width, src.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(src.width * f); cv.height = Math.round(src.height * f);
    const g = cv.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }
  async function readCanvas(cv, carry, label, token) {
    const g = cv.getContext("2d", { willReadFrequently: true }), img = g.getImageData(0, 0, cv.width, cv.height);
    return window.ColorKeyReader.readPage({ width: cv.width, height: cv.height, data: img.data }, state.net, {
      carry, onProgress: (i, n) => { if (token === state.token && $("omrStatus")) $("omrStatus").textContent = `${label}: staff ${Math.min(i + 1, n)} of ${n}`; },
      pause: () => new Promise((go, stop) => setTimeout(() => (token === state.token ? go() : stop(STOPPED)), 0)) });       // between two staves a read that was given up stops
  }

  // Another file may be opened while one is still being read: the read in progress is given up (it stops between two staves) and the new one starts.
  function cancel() { state.token += 1; }
  async function open(file) {
    const token = ++state.token;
    if (state.job) { try { await state.job; } catch (e) { /* its own business */ } }
    if (token !== state.token) return;
    const mine = state.job = read(file, token);
    try { await mine; } finally { if (state.job === mine) state.job = null; }
  }
  async function read(file, token) {
    state.pages = []; state.file = (file.name || "score").replace(/\.[^.]+$/, ""); state.view = "pitch"; state.harmony = null; state.beats = null;
    frame(state.file);
    const live = () => token === state.token, status = t => { if (live() && $("omrStatus")) $("omrStatus").textContent = t; };
    const isPdf = /\.pdf$/i.test(file.name || "") || file.type === "application/pdf";
    try {
      status("Getting the reader ready. The first time, your browser fetches it. After that it keeps it.");
      await ready(isPdf); if (!live()) return;
      const carry = {};
      if (isPdf) {
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        for (let p = 1; p <= pdf.numPages; p++) {
          if (!live()) return;
          status(`Page ${p} of ${pdf.numPages}: drawing`);
          const page = await pdf.getPage(p), base = page.getViewport({ scale: 1 });
          const render = async width => {
            const vp = page.getViewport({ scale: width / base.width }), cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
            const g = cv.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
            await page.render({ canvasContext: g, viewport: vp }).promise; return cv;
          };
          let cv = await render(1800), saved = JSON.stringify(carry), res = await readCanvas(cv, carry, `Page ${p} of ${pdf.numPages}`, token);
          if (res.space && res.space < 10 && base.width) {             // small print: draw the page larger and read again
            const again = Math.min(3600, Math.round(1800 * 13 / res.space));
            Object.keys(carry).forEach(k => delete carry[k]); Object.assign(carry, JSON.parse(saved));
            cv = await render(again); res = await readCanvas(cv, carry, `Page ${p} of ${pdf.numPages} (larger)`, token);
          }
          if (!live()) return;
          addPage(cv, res, p); summary();
        }
      } else {
        const bmp = await createImageBitmap(file), cv = canvasOf(bmp, 3200);
        const res = await readCanvas(cv, carry, "Reading", token);
        if (!live()) return;
        addPage(cv, res, 1); summary();
      }
      if (!live()) return;
      const notes = state.pages.reduce((a, p) => a + p.result.notes.length, 0);
      status(notes ? "" : "No music was found on this page. A sharper or straighter picture may help.");
      $("omrSave").disabled = !notes;
    } catch (e) {
      if (e === STOPPED || !live()) return;
      console.error(e);                                             // what the library said stays in the console
      status(isPdf ? "This PDF could not be opened. It may be damaged or locked." : "This picture could not be opened. The reader takes PNG and JPEG pictures and PDF files.");
    }
  }

  async function save() {
    const blobOf = cv => new Promise(r => cv.toBlob(r, "image/png"));
    let blob, name;
    const what = state.view === "harmony" ? "Harmony Color" : "Pitch Color";
    if (state.pages.length === 1) { blob = await blobOf(state.pages[0].canvas); name = state.file + " (" + what + ").png"; }
    else {
      const zip = new window.JSZip();
      for (const p of state.pages) zip.file(`${state.file} page ${String(p.num).padStart(2, "0")} (${what}).png`, await blobOf(p.canvas));
      blob = await zip.generateAsync({ type: "blob" }); name = state.file + " (" + what + ").zip";
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.ColorKeyOMR = { open, cancel, state, repaint: () => { if (!state.lang) return; state.pages.forEach(paint); if (state.pages.length && $("omrFacts")) summary(); } };
})();
