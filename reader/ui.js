/* Printed music on the page: a PDF, a scan or a photo is read on this device and its notes are colored where they stand.
   This small file is always loaded; the reader itself, its network and the PDF library are fetched only when a picture is dropped. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const SEMIS = [0, 2, 4, 5, 7, 9, 11], LETTERS = "CDEFGAB";
  const ACC = { "1": "♯", "-1": "♭", "2": "𝄪", "-2": "𝄫", "0": "" };
  const state = { net: null, pages: [], names: false, file: "", job: null, lang: null, token: 0 };
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
        <div class="meta"><p class="facts" id="omrFacts"></p></div>
        <div class="under"><ul class="legend" id="omrLegend"></ul><p class="status" id="omrStatus" role="status"></p></div>
        <p class="omr-say" id="omrSay">${mq("(hover: none)") ? "Tap" : "Point at"} a note to see how it was read.</p>
      </div>
      <div id="omrPages"></div>
      <p class="hint">${esc(hint)}</p>
    </section>`;
    $("omrNames").addEventListener("click", () => { state.names = !state.names; $("omrNames").setAttribute("aria-pressed", String(state.names)); state.pages.forEach(paint); });
    $("omrSave").addEventListener("click", save);
    box.querySelector(".seg").addEventListener("click", e => {
      const b = e.target.closest("button[data-omr]"); if (!b || b.dataset.omr === "pitch") return;
      $("omrStatus").textContent = "Harmony Color needs the rhythm as well as the notes. The reader does not read rhythm yet, so from a picture it gives Pitch Color. A MusicXML file gives both.";
    });
    box.scrollIntoView({ block: "start", behavior: mq("(prefers-reduced-motion: reduce)") ? "auto" : "smooth" });
  }

  const pcOf = n => (((SEMIS[n.letter] + n.alter) % 12) + 12) % 12;
  function paint(pg) {
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
      let best = null, bd = 1e9;
      result.notes.forEach(n => { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } });
      if (best && bd < Math.max(best.space * 1.6, finger ? 22 * cv.width / r.width : 0)) $("omrSay").innerHTML = '<span class="dot" style="background:' + esc(lang().pitch.colors[pcOf(best)]) + '"></span>' + esc(say(pg, best));
    };
    cv.addEventListener("mousemove", e => near(e, false));
    cv.addEventListener("click", e => near(e, e.pointerType === "touch" || mq("(hover: none)")));
    state.pages.push(pg); paint(pg);
    return pg;
  }

  function summary() {
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
    state.pages = []; state.file = (file.name || "score").replace(/\.[^.]+$/, "");
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
    if (state.pages.length === 1) { blob = await blobOf(state.pages[0].canvas); name = state.file + " (Pitch Color).png"; }
    else {
      const zip = new window.JSZip();
      for (const p of state.pages) zip.file(`${state.file} page ${String(p.num).padStart(2, "0")} (Pitch Color).png`, await blobOf(p.canvas));
      blob = await zip.generateAsync({ type: "blob" }); name = state.file + " (Pitch Color).zip";
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  window.ColorKeyOMR = { open, cancel, state, repaint: () => { if (!state.lang) return; state.pages.forEach(paint); if (state.pages.length && $("omrFacts")) summary(); } };
})();
