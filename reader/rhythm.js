/* Note values for printed music.
   The reader (reader.js) finds each notehead and each rest. This file looks at every one of them in its surroundings,
   as a person does: is there a stem, how many flags or beams end on it, is there a dot after it, is it a small note.
   A small network gives the answer for a picture cut around the mark: 128 x 48 pixels at 8 pixels to the staff space
   (eight spaces above and below, three to each side), ink against paper judged inside the picture itself.
   The answer is written on the mark as .rv = { value, dots, grace, stem, sure }:
     value  0 whole, 1 half, 2 quarter, 3 eighth, 4 16th, 5 32nd, 6 64th
     dots   0, 1 or 2      grace  a small note, not counted in the bar      stem  0 none, 1 up, 2 down
   harmony.js counts the bars from these. Trained by scripts/reader_rhythm_train.py; the same cut is made in
   scripts/reader_rhythm_data.py. Runs on the device, with the runtime the reader already uses. */
(function (root) {
  "use strict";
  var H = 128, W = 48, SP = 8, GROUPS = [7, 3, 2, 3];

  /* The picture around one point of the page. gray: the page as gray bytes (row by row), white outside. */
  function cut(gray, w, h, x, y, space, out, at) {
    var k = space / SP, n = Math.max(1, Math.min(4, Math.floor(k + 0.5)));
    function px(xx, yy) {
      if (xx < 0 || yy < 0 || xx > w - 1 || yy > h - 1) return 255;
      var x0 = Math.floor(xx), y0 = Math.floor(yy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = xx - x0, fy = yy - y0;
      return (gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx) * (1 - fy) + (gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx) * fy;
    }
    var hist = new Uint32Array(256), i = at;
    for (var v = 0; v < H; v++) {
      var yc = y + (v + 0.5 - H / 2) * k;
      for (var u = 0; u < W; u++) {
        var xc = x + (u + 0.5 - W / 2) * k, s = 0;
        for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) s += px(xc + ((a + 0.5) / n - 0.5) * k - 0.5, yc + ((b + 0.5) / n - 0.5) * k - 0.5);
        s /= n * n; out[i++] = s;
        hist[Math.max(0, Math.min(255, Math.floor(s + 0.5)))]++;
      }
    }
    // ink against paper, as the reader judges it along its bands: paper is the 85th percentile, ink the darkest half percent
    var tot = H * W, acc = 0, dark = 0, paper = 255, gotD = false, gotP = false;
    for (var q = 0; q < 256; q++) { acc += hist[q]; if (!gotD && acc >= tot * 0.005) { dark = q; gotD = true; } if (!gotP && acc >= tot * 0.85) { paper = q; gotP = true; } }
    var rng = paper - dark;
    for (i = at; i < at + tot; i++) { var z = rng < 12 ? 0 : (paper - out[i]) / rng; out[i] = z < 0 ? 0 : z > 1 ? 1 : z; }
  }

  async function load(base, opts) {
    opts = opts || {};
    if (!root.ort) throw new Error("the runtime for the network is not on this page");
    if (opts.wasm) root.ort.env.wasm.wasmPaths = opts.wasm;
    var session = await root.ort.InferenceSession.create(base + "rhythm.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return { session: session };
  }

  /* The answer for each picture, and what else it might be: up to two other readings of value and dots that the network
     gave at least one chance in a hundred, each with its doubt lp = ln(chance of the first reading / chance of this one).
     harmony.js may take one of them when the bar does not add up otherwise. */
  function decode(logits, n) {
    var out = [], per = GROUPS[0] + GROUPS[1] + GROUPS[2] + GROUPS[3];
    for (var i = 0; i < n; i++) {
      var o = i * per, pick = [], probs = [];
      GROUPS.forEach(function (g) {
        var best = 0, m = -Infinity, sum = 0, p = [];
        for (var j = 0; j < g; j++) if (logits[o + j] > m) { m = logits[o + j]; best = j; }
        for (j = 0; j < g; j++) { p.push(Math.exp(logits[o + j] - m)); sum += p[j]; }
        pick.push(best); probs.push(p.map(function (q) { return q / sum; }));
        o += g;
      });
      var pv = probs[0], pd = probs[1], top = pv[pick[0]] * pd[pick[1]], alts = [];
      for (var a = 0; a < GROUPS[0]; a++) for (var b = 0; b < GROUPS[1]; b++) {
        if (a === pick[0] && b === pick[1]) continue;
        var q2 = pv[a] * pd[b]; if (q2 >= 0.01) alts.push({ value: a, dots: b, lp: Math.log(top / q2) });
      }
      alts.sort(function (x, y) { return x.lp - y.lp; });
      out.push({ value: pick[0], dots: pick[1], grace: pick[2] === 1, stem: pick[3], sure: Math.min(pv[pick[0]], pd[pick[1]]), alts: alts.slice(0, 2) });
    }
    return out;
  }

  /* pts: [{ x, y, space }] on the page. Returns one answer for each. */
  async function classify(net, gray, w, h, pts, onProgress) {
    var out = [], B = 96;
    for (var a = 0; a < pts.length; a += B) {
      var part = pts.slice(a, a + B), buf = new Float32Array(part.length * H * W);
      part.forEach(function (p, i) { cut(gray, w, h, p.x, p.y, p.space, buf, i * H * W); });
      var res = await net.session.run({ crop: new root.ort.Tensor("float32", buf, [part.length, 1, H, W]) });
      Array.prototype.push.apply(out, decode(res.logits.data, part.length));
      if (onProgress) onProgress(Math.min(pts.length, a + B), pts.length);
    }
    return out;
  }

  /* Every notehead and rest of one page gets its value. page: what reader.js gave for it. */
  async function readPage(net, gray, w, h, page, onProgress) {
    var marks = [], pts = [];
    (page.notes || []).forEach(function (n) { marks.push(n); pts.push({ x: n.x, y: n.y, space: n.space }); });
    (page.staves || []).forEach(function (st) { (st.marks || []).forEach(function (m) { if ((m.kind || m[0]) === "rest") { marks.push(m); pts.push({ x: m.x, y: m.y, space: st.space }); } }); });
    var ans = await classify(net, gray, w, h, pts, onProgress);
    ans.forEach(function (rv, i) { marks[i].rv = rv; });
    return ans.length;
  }

  root.ColorKeyReaderRhythm = { version: "0.1.0", load: load, cut: cut, classify: classify, readPage: readPage, decode: decode, H: H, W: W, SP: SP };
})(typeof window !== "undefined" ? window : globalThis);
