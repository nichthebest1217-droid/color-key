/* A picture of a page is seldom held straight, and the reader loses the staves when they lean by more than about two
   degrees. Before reading, the page finds how far the staff lines lean and turns the picture back.

   How the lean is found: the picture is made small, ink is told from paper (the reader's own rule), and for every
   angle from -8 to 8 degrees the ink is summed along lines of that slope. At the angle of the staff lines the sums are
   sharpest: almost all the ink of a line falls into one sum. A picture that leans by less than 0.3 degrees is left
   exactly as it is, so a page that was printed straight (a PDF from a notation program) is read as before.

   Only a turn is undone. A page photographed from the side (wider at one end) or a curved page is not flattened. */
(function (root) {
  "use strict";
  var MAX_DEG = 8, LEAST_DEG = 0.3;

  /* gray: the page as gray bytes. Returns the lean of the staff lines in degrees: positive when they run down to the right. */
  function angle(gray, w, h, R) {
    R = R || root.ColorKeyReader;
    var f = Math.max(1, Math.round(Math.max(w, h) / 1000)), sw = Math.floor(w / f), sh = Math.floor(h / f), small = new Uint8Array(sw * sh);
    for (var y = 0; y < sh; y++) for (var x = 0; x < sw; x++) {
      var s = 0; for (var b = 0; b < f; b++) for (var a = 0; a < f; a++) s += gray[(y * f + b) * w + x * f + a];
      small[y * sw + x] = s / (f * f);
    }
    var ink = R.binarize(small, sw, sh), xs = [], ys = [];
    for (y = 0; y < sh; y++) for (x = 0; x < sw; x++) if (ink[y * sw + x]) { xs.push(x - sw / 2); ys.push(y); }
    if (xs.length < 200) return 0;
    var off = Math.ceil(sw / 2 * Math.tan(MAX_DEG * Math.PI / 180)) + 2, hist = new Float64Array(sh + 2 * off);
    function sharp(deg) {
      var t = Math.tan(deg * Math.PI / 180), i, sum = 0; hist.fill(0);
      for (i = 0; i < xs.length; i++) hist[Math.round(ys[i] - xs[i] * t) + off] += 1;
      for (i = 0; i < hist.length; i++) sum += hist[i] * hist[i];
      return sum;
    }
    var best = 0, bs = -1, d, sc;
    for (d = -MAX_DEG; d <= MAX_DEG + 1e-9; d += 0.25) { sc = sharp(d); if (sc > bs) { bs = sc; best = d; } }
    var around = best;
    for (d = around - 0.2; d <= around + 0.2 + 1e-9; d += 0.05) { sc = sharp(d); if (sc > bs) { bs = sc; best = d; } }
    // the staff lines must stand out: a page with no long level lines (a photo of something else) is not turned
    var flat = sharp(best + (best > 0 ? -3 : 3));
    if (bs < 1.3 * flat) return 0;
    return Math.round(best * 100) / 100;
  }

  /* canvas: the page. Returns { canvas, angle }: the same canvas when it stands straight, else a new one turned level. */
  function straighten(canvas, R) {
    var w = canvas.width, h = canvas.height, g = canvas.getContext("2d", { willReadFrequently: true });
    var img = g.getImageData(0, 0, w, h), gray = (R || root.ColorKeyReader).toGray(img.data, w, h), deg = angle(gray, w, h, R);
    if (Math.abs(deg) < LEAST_DEG) return { canvas: canvas, angle: 0 };
    var out = document.createElement("canvas"); out.width = w; out.height = h;
    var c = out.getContext("2d", { willReadFrequently: true });
    c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
    // paper around the turned page takes the page's own brightness, so that no dark wedge is read as ink
    var paper = 0, n = 0; for (var i = 0; i < gray.length; i += 211) { if (gray[i] > 128) { paper += gray[i]; n += 1; } }
    paper = n ? Math.round(paper / n) : 255; c.fillStyle = "rgb(" + paper + "," + paper + "," + paper + ")"; c.fillRect(0, 0, w, h);
    c.translate(w / 2, h / 2); c.rotate(-deg * Math.PI / 180); c.drawImage(canvas, -w / 2, -h / 2);
    return { canvas: out, angle: deg };
  }

  root.ColorKeyStraighten = { version: "0.1.0", angle: angle, straighten: straighten, LEAST_DEG: LEAST_DEG };
})(typeof window !== "undefined" ? window : globalThis);
