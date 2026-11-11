/* Ties, for the ear only.
   The reader does not read ties, so a held note would sound twice. Before the page plays a picture, this file looks at every
   pair of noteheads that could be tied (the same staff and line, the same pitch, the second starting when the first ends) and
   asks whether a thin bowed line runs from one to the other. Where it does, the two sound as one note. Nothing here changes
   the colors or the count of the bars.

   It does not see a tie that runs over the end of a line, and it cannot tell a tie from a slur drawn between two notes of the
   same pitch (in print they are the same sign). */
(function (root) {
  "use strict";
  var P = { edge: 0.55, dark: 128, thick: 0.42, line: 0.2, span: 0.8, tol: 0.13, need: 0.7, far: 26, near: 1.3 };

  /* How much of the way between two noteheads is covered by one bowed line: { cov (0..1), side (1 below, -1 above), bow }.
     gray: the page as gray bytes, row by row. a, b: { x, y, space }. staff: { x0, x1, top, topEnd, space }. */
  function arc(gray, W, H, a, b, staff) {
    var sp = (a.space + b.space) / 2, y0 = (a.y + b.y) / 2, xl = a.x + P.edge * sp, xr = b.x - P.edge * sp, none = { cov: 0, side: 0, bow: 0 };
    if (xr - xl < 3) return none;
    var r0 = Math.max(0, Math.floor(y0 - 2.4 * sp)), r1 = Math.min(H, Math.floor(y0 + 2.4 * sp) + 1), c0 = Math.max(0, Math.round(xl)), c1 = Math.min(W, Math.round(xr) + 1);
    var mid = (xl + xr) / 2, half = (xr - xl) / 2, below = [], above = [], us = [];
    for (var c = c0; c < c1; c++) {
      var u = (c - mid) / half; if (Math.abs(u) > P.span) continue;
      var tl = staff.top + (staff.topEnd - staff.top) * (c - staff.x0) / Math.max(1, staff.x1 - staff.x0), lo = [], hi = [], s = -1;
      for (var r = r0; r <= r1; r++) {
        var dark = r < r1 && gray[r * W + c] < P.dark;
        if (dark && s < 0) s = r;
        else if (!dark && s >= 0) {
          var th = r - s, cy = (s + r - 1) / 2; s = -1;
          if (th > P.thick * sp) continue;                              // a beam, a stem, a notehead
          var k = Math.round((cy - tl) / staff.space);
          if (k >= -1 && k <= 5 && Math.abs(cy - (tl + k * staff.space)) < 0.2 * sp && th <= P.line * sp) continue;       // a staff line and nothing more
          var d = (cy - y0) / sp;
          if (d > 0.1 && d < 2.3) lo.push(d); else if (d < -0.1 && d > -2.3) hi.push(-d);
        }
      }
      us.push(u); below.push(lo); above.push(hi);
    }
    if (us.length < 3) return none;
    var best = none;
    [[1, below], [-1, above]].forEach(function (sd) {
      var cols = sd[1], n = cols.length, some = 0; for (var i = 0; i < n; i++) if (cols[i].length) some += 1;
      if (some < P.need * n) return;
      for (var hb = 2; hb < 30; hb++) for (var de = 2; de < 26; de++) {          // the bow and the distance at its ends, in twentieths of a staff space
        var hit = 0;
        for (var j = 0; j < n; j++) { var want = de * 0.05 + hb * 0.05 * (1 - us[j] * us[j]), rs = cols[j]; for (var q = 0; q < rs.length; q++) if (Math.abs(rs[q] - want) < P.tol) { hit += 1; break; } }
        if (hit / n > best.cov) best = { cov: hit / n, side: sd[0], bow: hb * 0.05 };
      }
    });
    return best;
  }

  /* The pairs that could be tied. recs: [{ part, midi, start, end (strings of exact time), page, staff, x, y, space }].
     Returns [[i, j]] with j starting where i ends, at the same pitch, on the same staff of the same page, to its right. */
  function pairs(recs) {
    var at = {}; recs.forEach(function (r, i) { at[r.part + "|" + r.midi + "|" + r.start] = i; });
    var out = [];
    recs.forEach(function (a, i) {
      var j = at[a.part + "|" + a.midi + "|" + a.end]; if (j === undefined || j === i) return;
      var b = recs[j], sp = (a.space + b.space) / 2;
      if (b.page !== a.page || b.staff !== a.staff || Math.abs(b.y - a.y) > 0.3 * sp || b.x - a.x < P.near * sp || b.x - a.x > P.far * sp) return;
      out.push([i, j]);
    });
    return out;
  }

  /* The score of a picture with its tied notes joined. hr: what ColorKeyReaderHarmony.read gave. pages: [{ gray, width, height, staves }].
     Returns { score (the same score with other sounding notes), tied (how many notes were joined to the one before), asked }. */
  function join(hr, pages) {
    var score = hr.score, recs = [], k = 0;
    score.notation.forEach(function (r) {
      if (r.isRest || !r.el || !r.el.getAttribute("id")) return;
      var h = hr.heads[k++]; if (!h || h.grace || !r.sounding) return;
      recs.push({ part: r.partId, midi: r.sounding.midi, start: r.onset.str(), end: r.onset.add(r.duration).str(), page: h.page, staff: h.note.staff, x: h.x, y: h.y, space: h.space, rec: r });
    });
    var next = {}, into = {}, asked = 0;
    pairs(recs).forEach(function (p) {
      var a = recs[p[0]], b = recs[p[1]], pg = pages[a.page], st = pg && pg.staves[a.staff]; if (!st) return;
      asked += 1;
      if (arc(pg.gray, pg.width, pg.height, a, b, st).cov >= P.need) { next[p[0]] = p[1]; into[p[1]] = true; }
    });
    var byRec = new Map(); recs.forEach(function (r, i) { byRec.set(r.rec, i); });
    var sounding = [], tied = 0;
    score.sounding.forEach(function (e) {
      var i = e.records && e.records.length === 1 ? byRec.get(e.records[0]) : undefined;
      if (i === undefined) { sounding.push(e); return; }
      if (into[i]) { tied += 1; return; }                                // it sounds as the end of the note before
      var last = i, guard = 0; while (next[last] !== undefined && guard++ < 64) last = next[last];
      sounding.push(last === i ? e : { partId: e.partId, start: e.start, end: recs[last].rec.onset.add(recs[last].rec.duration), pitch: e.pitch, records: e.records, mergedFromTie: true });
    });
    var out = {}; for (var key in score) out[key] = score[key]; out.sounding = sounding;
    return { score: out, tied: tied, asked: asked };
  }

  root.ColorKeyTies = { version: "0.1.0", P: P, arc: arc, pairs: pairs, join: join };
})(typeof window !== "undefined" ? window : globalThis);
