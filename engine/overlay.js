/* Color Key score overlay: draws Roman-numeral labels (stacked figures) under the lowest staff of each system and optional
   notes above the top staff, positioned from OpenSheetMusicDisplay's graphic model (1 unit = 10 viewBox px).
   After drawing, the labels of each system are checked against everything the score engraver drew: a line of labels that
   touches a note, a stem or a slur is moved down until it is clear, and the result reports what still touches (layout). */
(function (global) {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const PRETTY = s => String(s || "").replace(/##/g, "𝄪").replace(/#/g, "♯").replace(/bb/g, "𝄫").replace(/b/g, "♭");
  function el(name, attrs, text) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; }
  function entryX(gs, mi, q) {
    const staves = gs.MeasureList[mi]; if (!staves) return null;
    const cands = [];
    for (const gm of staves) { if (!gm) continue; for (const se of gm.staffEntries) cands.push([se.relInMeasureTimestamp.RealValue * 4, se.PositionAndShape.AbsolutePosition.x]); }
    cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const exact = cands.find(c => Math.abs(c[0] - q) < 1e-6); if (exact) return exact[1];
    const gm = staves.find(Boolean); const m0 = gm.PositionAndShape.AbsolutePosition.x + (gm.beginInstructionsWidth || 0) + 1.2, m1 = gm.PositionAndShape.AbsolutePosition.x + gm.PositionAndShape.Size.width;
    let lo = [0, m0], hi = [Infinity, m1];
    for (const c of cands) { if (c[0] < q && c[0] >= lo[0]) lo = c; if (c[0] > q && c[0] < hi[0]) hi = c; }
    if (hi[0] === Infinity) { const len = (gm.parentSourceMeasure && gm.parentSourceMeasure.Duration) ? gm.parentSourceMeasure.Duration.RealValue * 4 : q + 1; hi = [len, m1 - 1]; }
    return lo[1] + (hi[1] - lo[1]) * (q - lo[0]) / Math.max(1e-9, hi[0] - lo[0]);
  }
  // one label line: [prefix] acc numeral quality [figures stacked | inline] adds target [?]
  function drawLine(g, x, y, part, color, size, font, cueColor) {
    const t = el("text", { x, y, fill: color, "font-family": font, "font-size": size, "font-weight": 700 });
    let cursor = x;
    const add = (text, attrs) => { const s = el("tspan", Object.assign({ x: cursor, y }, attrs || {}), text); t.appendChild(s); return s; };
    g.appendChild(t);
    const measure = () => t.getBBox().x + t.getBBox().width;
    if (part.prefix) { add(PRETTY(part.prefix) + " ", { "font-style": "italic" }); cursor = measure(); }
    if (part.special) add(part.special); else add(PRETTY(part.acc) + part.numeral + (part.quality || "").replace("o", "°"));
    cursor = measure();
    const small = size * 0.64;
    if (part.figures && part.figures.length === 2) {
      const a = el("tspan", { x: cursor + 0.6, y: y - size * 0.42, "font-size": small }, part.figures[0]); t.appendChild(a);
      const b = el("tspan", { x: cursor + 0.6, y: y + size * 0.14, "font-size": small }, part.figures[1]); t.appendChild(b);
      cursor = Math.max(a.getBBox().x + a.getBBox().width, b.getBBox().x + b.getBBox().width);
    } else if ((part.figures && part.figures.length === 1) || part.inlineFigure) {
      const s = el("tspan", { x: cursor + 0.6, y: y - size * 0.42, "font-size": small }, part.figures && part.figures.length ? part.figures[0] : PRETTY(part.inlineFigure).replace("-", "–")); t.appendChild(s);
      cursor = s.getBBox().x + s.getBBox().width;
    }
    if (part.adds) { const s = el("tspan", { x: cursor + 0.5, y: y - size * 0.42, "font-size": small }, PRETTY(part.adds)); t.appendChild(s); cursor = s.getBBox().x + s.getBBox().width; }
    if (part.target) { const s = el("tspan", { x: cursor, y }, PRETTY(part.target)); t.appendChild(s); cursor = s.getBBox().x + s.getBBox().width; }
    if (part.cue) { const s = el("tspan", { x: cursor + size * 0.22, y, "font-size": size * 0.78, fill: cueColor, "font-weight": 400, "font-family": "'Hanken Grotesk', system-ui, sans-serif" }, "?"); t.appendChild(s); cursor = s.getBBox().x + s.getBBox().width; }
    return cursor;
  }
  const BUCKET = 60;
  function scoreBoxes(svg, overlayGroup) {
    const vb = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : { width: 1e9, height: 1e9 };
    const grid = new Map(); let n = 0;
    for (const e of svg.querySelectorAll("path, rect, text")) {
      if (overlayGroup.contains(e)) continue;
      let b; try { b = e.getBBox(); } catch (err) { continue; }
      if (!(b.width > 0.2 || b.height > 0.2)) continue;
      if (b.width > vb.width * 0.9 && b.height > vb.height * 0.5) continue;        // the page background
      const box = { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height };
      for (let k = Math.floor(box.y / BUCKET); k <= Math.floor(box.b / BUCKET); k++) { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(box); }
      n += 1;
    }
    return { grid, n };
  }
  // the deepest overlap of a text box with the engraved score: how far the box must move down (or up) to be clear
  function touching(boxes, tb, direction) {
    let worst = 0;
    for (let k = Math.floor(tb.y / BUCKET); k <= Math.floor(tb.b / BUCKET); k++) {
      for (const g of (boxes.grid.get(k) || [])) {
        if (g.x < tb.r && tb.x < g.r && g.y < tb.b && tb.y < g.b) worst = Math.max(worst, direction === "up" ? tb.b - g.y : g.b - tb.y);
      }
    }
    return worst;
  }
  // the inked part of a text element: its box without the empty room above capitals and below the baseline
  function inkBox(t) { const b = t.getBBox(); return { x: b.x + 1, y: b.y + b.height * 0.24, r: b.x + b.width - 1, b: b.y + b.height * 0.86 }; }
  function drawOverlay(osmd, host, labels, notes, opts) {
    const o = Object.assign({ size: 17, font: "'Old Standard TT', 'Times New Roman', serif", noteFont: "'Hanken Grotesk', system-ui, sans-serif", noteColor: "#6B7180", cueColor: "#6B7180", gap: 5 }, opts || {});
    const svg = host.querySelector("svg"); if (!svg) return null;
    const old = svg.querySelector("g.ck-overlay"); if (old) old.remove();
    const g = el("g", { class: "ck-overlay" }); svg.appendChild(g);
    const gs = osmd.GraphicSheet; const U = 10;
    const sysOf = mi => { const st = gs.MeasureList[mi]; const gm = st && st.find(Boolean); return gm ? gm.ParentMusicSystem : null; };
    const rows = new Map();   // system id -> array of right edges per row
    const baseline = new Map();
    const systemBase = sys => {
      if (baseline.has(sys)) return baseline.get(sys);
      const lines = sys.StaffLines; const bottom = lines[lines.length - 1];
      const by = bottom.PositionAndShape.AbsolutePosition.y; let bmax = 4;
      try { bmax = Math.max(4, bottom.SkyBottomLineCalculator.getBottomLineMax()); } catch (e) {}
      const top = lines[0]; let smin = 0; try { smin = Math.min(0, top.SkyBottomLineCalculator.getSkyLineMin()); } catch (e) {}
      const v = { label: (by + bmax) * U + o.size * 1.35, note: (top.PositionAndShape.AbsolutePosition.y + smin) * U - 6 };
      baseline.set(sys, v); return v;
    };
    let placed = 0, maxDrop = 0;
    const groups = new Map();       // system -> { labels: <g>, notes: <g> }
    const groupOf = (sys, kind) => { if (!groups.has(sys)) groups.set(sys, {}); const o = groups.get(sys); if (!o[kind]) { o[kind] = el("g", { class: "ck-" + kind }); g.appendChild(o[kind]); } return o[kind]; };
    for (const lab of labels) {
      const sys = sysOf(lab.measureIndex); if (!sys) continue;
      const x = entryX(gs, lab.measureIndex, lab.q); if (x === null) continue;
      const base = systemBase(sys);
      if (!rows.has(sys)) rows.set(sys, []);
      const r = rows.get(sys);
      const xpx = x * U - 1;
      let row = 0; while (r[row] !== undefined && r[row] + o.gap > xpx) row += 1;
      const lineH = o.size * 1.18;
      let right = xpx;
      lab.lines.forEach((part, k) => {
        const y = base.label + (row + k) * lineH;
        const lg = groupOf(sys, "labels");
        right = Math.max(right, drawLine(lg, xpx, y, part, lab.color, o.size, o.font, o.cueColor));
        if (lab.id !== undefined && lg.lastChild) lg.lastChild.setAttribute("data-i", lab.id);   // lets a page find the label a reader clicks
        r[row + k] = Math.max(r[row + k] === undefined ? -1e9 : r[row + k], right);
      });
      maxDrop = Math.max(maxDrop, (row + lab.lines.length) * lineH);
      placed += 1;
    }
    const noteRows = new Map();
    for (const n of (notes || [])) {
      const sys = sysOf(n.measureIndex); if (!sys) continue;
      const x = entryX(gs, n.measureIndex, 0); if (x === null) continue;
      const base = systemBase(sys);
      const t = el("text", { x: x * U, y: base.note, fill: o.noteColor, "font-family": o.noteFont, "font-size": 12.5, "font-style": "italic" }, n.text);
      const prev = noteRows.get(sys);
      if (prev !== undefined && prev + 12 > x * U) t.setAttribute("y", base.note - 15);
      groupOf(sys, "notes").appendChild(t); noteRows.set(sys, t.getBBox().x + t.getBBox().width);
    }
    // ---- the layout check: move a system's labels clear of the engraved score, then report what still touches
    const layout = { systems: 0, labels: placed, moved: 0, labelsTouching: 0, notesTouching: 0, labelsOverlapping: 0, need: 0, where: [] };
    try {
      const boxes = scoreBoxes(svg, g);
      const systems = [...gs.MusicPages].flatMap(pg => pg.MusicSystems);
      layout.systems = systems.length;
      const bottomOf = new Map(), noteUp = new Map();
      for (const sys of systems) {
        const gr = groups.get(sys); if (!gr) continue;
        if (gr.labels) {
          const texts = [...gr.labels.querySelectorAll("text")];
          // move the whole line of labels down until none of them touches the engraved score (a few steps; a slur or a
          // displaced rest can sit under the first obstacle)
          let dy = 0;
          for (let step = 0; step < 5 && dy < 90; step++) {
            let more = 0; for (const t of texts) { const b = inkBox(t); b.y += dy; b.b += dy; more = Math.max(more, touching(boxes, b, "down")); }
            if (more <= 0.5) break;
            dy = Math.min(dy + more + 4, 90);
          }
          if (dy > 0) { gr.labels.setAttribute("transform", "translate(0 " + dy.toFixed(1) + ")"); layout.moved += 1; }
          let bottom = 0;
          for (const t of texts) {
            const b = inkBox(t); b.y += dy; b.b += dy; bottom = Math.max(bottom, b.b);
            if (touching(boxes, b, "down") > 0.5) { layout.labelsTouching += 1; if (layout.where.length < 12 && t.hasAttribute("data-i")) layout.where.push(parseInt(t.getAttribute("data-i"), 10)); }
          }
          // labels of one line must not run into each other
          const ink = texts.map(inkBox).sort((a, b) => a.x - b.x);
          for (let i = 0; i < ink.length; i++) for (let j = i + 1; j < ink.length && ink[j].x < ink[i].r; j++) if (ink[i].y < ink[j].b - 4 && ink[j].y < ink[i].b - 4) layout.labelsOverlapping += 1;
          bottomOf.set(sys, bottom);
          maxDrop = Math.max(maxDrop, bottom - (systemBase(sys).label - o.size * 1.35));
        }
        if (gr.notes) {
          const texts = [...gr.notes.querySelectorAll("text")];
          let up = 0; for (const t of texts) up = Math.max(up, touching(boxes, inkBox(t), "up"));
          if (up > 0) { up = Math.min(up + 4, 60); gr.notes.setAttribute("transform", "translate(0 " + (-up).toFixed(1) + ")"); noteUp.set(sys, up); }
          for (const t of texts) { const b = inkBox(t); b.y -= up; b.b -= up; if (touching(boxes, b, "up") > 0.5) layout.notesTouching += 1; }
        }
      }
      // room between a system's labels and whatever is drawn above the next system (its notes above the staff, the annotations)
      for (let i = 0; i + 1 < systems.length; i++) {
        const bottom = bottomOf.get(systems[i]); if (bottom === undefined) continue;
        const next = systems[i + 1], top = next.StaffLines[0]; let smin = 0; try { smin = Math.min(0, top.SkyBottomLineCalculator.getSkyLineMin()); } catch (e) {}
        let nextTop = (top.PositionAndShape.AbsolutePosition.y + smin) * U;
        const ng = groups.get(next); if (ng && ng.notes) for (const t of ng.notes.querySelectorAll("text")) nextTop = Math.min(nextTop, t.getBBox().y - (noteUp.get(next) || 0));
        layout.need = Math.max(layout.need, bottom + 10 - nextTop);
      }
      layout.scoreElements = boxes.n;
    } catch (err) { layout.error = String(err && err.message || err); }
    return { placed, maxDrop, layout };
  }
  // Staves of one system, and neighbouring systems, compared along their whole width: where the lowest ink of the staff above
  // reaches below the highest ink of the staff under it, the two overlap.
  function staffOverlaps(osmd) {
    const out = { staves: 0, overlaps: 0, where: [] };
    try {
      const systems = [...osmd.GraphicSheet.MusicPages].flatMap(pg => pg.MusicSystems);
      const lines = [];
      for (const sys of systems) for (const sl of sys.StaffLines) lines.push({ sl, sys });
      out.staves = lines.length;
      for (let i = 0; i + 1 < lines.length; i++) {
        const a = lines[i].sl, b = lines[i + 1].sl;
        const ya = a.PositionAndShape.AbsolutePosition.y, yb = b.PositionAndShape.AbsolutePosition.y;
        const bot = a.BottomLine || [], sky = b.SkyLine || []; const n = Math.min(bot.length, sky.length); let deep = 0;
        for (let k = 0; k < n; k++) { const d = (ya + bot[k]) - (yb + sky[k]); if (d > deep) deep = d; }
        if (deep > 0.15) { out.overlaps += 1; const gm = b.Measures && b.Measures[0]; if (out.where.length < 8) out.where.push({ measure: gm && gm.MeasureNumber !== undefined ? gm.MeasureNumber : null, sameSystem: lines[i].sys === lines[i + 1].sys, depth: Math.round(deep * 10) / 10 }); }
      }
    } catch (err) { out.error = String(err && err.message || err); }
    return out;
  }
  global.ColorKeyOverlay = { drawOverlay, entryX, drawLine, staffOverlaps };
})(typeof window !== "undefined" ? window : globalThis);
