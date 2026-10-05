/* Color Key reader: reads printed music from a picture of a page, on this device.
   It works the way a person reads: find the staves; follow each staff from left to right through a band that keeps the
   staff straight and at one size; mark each symbol (a small network trained on engraved pages does the looking); then
   reason: the clef names the lines, the key signature and the accidentals earlier in the bar alter the notes.
   Nothing here contacts a server. */
(function (root) {
  'use strict';
  var SP = 8, HEIGHT = 136, TOP = 52.5;
  var CLASSES = ['head_black', 'head_half', 'head_whole', 'sharp', 'flat', 'natural', 'double_sharp', 'double_flat', 'clef_G', 'clef_F', 'clef_C', 'barline', 'rest', 'head_on_line'];
  var LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], SEMIS = [0, 2, 4, 5, 7, 9, 11];
  var SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6], FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];   // letters F C G D A E B / B E A D G C F

  /* ---------- the picture ---------- */
  function toGray(rgba, w, h) {
    var g = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) {
      var a = rgba[j + 3] / 255;                                   // a transparent page is white paper
      g[i] = Math.round((0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) * a + 255 * (1 - a));
    }
    return g;
  }

  /* Ink or paper, judged against the neighborhood (so shadows and tinted paper do not matter). */
  function binarize(gray, w, h) {
    var S = Math.max(16, (Math.max(w, h) / 24) | 0), half = S >> 1, W1 = w + 1;
    var integ = new Float64Array(W1 * (h + 1));
    for (var y = 0; y < h; y++) {
      var run = 0;
      for (var x = 0; x < w; x++) { run += gray[y * w + x]; integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + run; }
    }
    var ink = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        var sum = integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0];
        var v = gray[y * w + x];
        if (v * (x1 - x0) * (y1 - y0) < sum * 0.82 && v < 215) ink[y * w + x] = 1;
      }
    }
    return ink;
  }

  /* The distance between staff lines, from the most common "thin line, then gap" down the page. */
  function lineSpacing(ink, w, h) {
    var maxS = Math.max(8, Math.min(120, (h / 12) | 0)), hist = new Float64Array(maxS + 1), thick = new Float64Array(maxS + 1);
    var step = Math.max(1, (w / 400) | 0);
    for (var x = 0; x < w; x += step) {
      var y = 0;
      while (y < h) {
        while (y < h && !ink[y * w + x]) y++;
        var b0 = y; while (y < h && ink[y * w + x]) y++;
        var b = y - b0, g0 = y; var yy = y; while (yy < h && !ink[yy * w + x]) yy++;
        var g = yy - g0;
        if (yy < h && b > 0 && g > 1 && b < g && b + g <= maxS) { hist[b + g]++; thick[b]++; }
      }
    }
    var best = 0, bi = 0;
    for (var i = 4; i <= maxS; i++) { var s = hist[i] + 0.5 * (hist[i - 1] + (hist[i + 1] || 0)); if (s > best) { best = s; bi = i; } }
    if (!bi || best < 20) return null;
    var num = 0, den = 0; for (i = bi - 1; i <= bi + 1; i++) { num += i * (hist[i] || 0); den += hist[i] || 0; }
    var ti = 1, tb = 0; for (i = 1; i < bi; i++) if (thick[i] > tb) { tb = thick[i]; ti = i; }
    return { space: num / den, thick: ti };
  }

  /* Staves: in each upright slab of the page, five thin long lines the same distance apart; slabs are then joined,
     so a staff may tilt or bend. Returns [{x0, x1, space, pts: [{x, y, space}]}], top to bottom. */
  function findStaves(ink, w, h, sp0, thick) {
    var maxThin = Math.max(2 * thick + 1, Math.round(0.34 * sp0)), minRun = Math.round(1.0 * sp0);
    var thin = new Uint8Array(w * h);
    for (var x = 0; x < w; x++) {                                   // thin from top to bottom ...
      var y = 0;
      while (y < h) {
        while (y < h && !ink[y * w + x]) y++;
        var b0 = y; while (y < h && ink[y * w + x]) y++;
        if (y - b0 > 0 && y - b0 <= maxThin) for (var k = b0; k < y; k++) thin[k * w + x] = 1;
      }
    }
    var line = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {                                       // ... and long from left to right (small breaks allowed)
      x = 0;
      while (x < w) {
        while (x < w && !thin[y * w + x] && !(y > 0 && thin[(y - 1) * w + x]) && !(y + 1 < h && thin[(y + 1) * w + x])) x++;
        var a0 = x, gap = 0, last = x;
        while (x < w && gap <= 2) {
          if (thin[y * w + x] || (y > 0 && thin[(y - 1) * w + x]) || (y + 1 < h && thin[(y + 1) * w + x])) { gap = 0; last = x; } else gap++;
          x++;
        }
        if (last - a0 >= minRun) for (k = a0; k <= last; k++) if (thin[y * w + k]) line[y * w + k] = 1;
      }
    }
    var slabW = Math.max(24, Math.round(10 * sp0)), stepW = Math.max(12, slabW >> 1), found = [];
    var proj = new Float32Array(h);
    for (var xs = 0; xs < w; xs += stepW) {
      var xe = Math.min(w, xs + slabW); if (xe - xs < slabW * 0.5) break;
      for (y = 0; y < h; y++) { var c = 0; for (x = xs; x < xe; x++) c += line[y * w + x]; proj[y] = c / (xe - xs); }
      var at = function (yf) { var r = Math.round(yf); if (r < 1 || r >= h - 1) return 0; return Math.max(proj[r], proj[r - 1], proj[r + 1]); };
      var cands = [];
      for (y = 1; y < h - 4 * sp0; y++) {
        if (proj[y] < 0.22) continue;
        var bestS = 0, bestSp = 0;
        for (var f = 0.93; f <= 1.071; f += 0.01) {
          var spv = sp0 * f, mn = 1, sum = 0;
          for (var i = 0; i < 5; i++) { var v = at(y + i * spv); if (v < mn) mn = v; sum += v; }
          if (mn >= 0.25 && sum >= 2.2 && sum > bestS) { bestS = sum; bestSp = spv; }
        }
        if (bestS && at(y - bestSp) < 0.3 * bestS / 5 + 0.25) cands.push({ y: y, sp: bestSp, s: bestS });
      }
      cands.sort(function (a, b) { return b.s - a.s; });
      var kept = [];
      cands.forEach(function (cd) { if (!kept.some(function (q) { return Math.abs(q.y - cd.y) < 4.5 * sp0; })) kept.push(cd); });
      kept.forEach(function (cd) {                                  // exact line places: center of each line's ink
        var ys = [];
        for (var i = 0; i < 5; i++) {
          var yc = cd.y + i * cd.sp, num = 0, den = 0, r = Math.max(2, Math.ceil(0.3 * sp0));
          for (var q = Math.round(yc) - r; q <= Math.round(yc) + r; q++) if (q >= 0 && q < h) { num += q * proj[q]; den += proj[q]; }
          ys.push(den ? num / den + 0.5 : yc + 0.5);
        }
        var mean = (ys[0] + ys[1] + ys[2] + ys[3] + ys[4]) / 5, slope = (-2 * ys[0] - ys[1] + ys[3] + 2 * ys[4]) / 10;
        found.push({ x: (xs + xe) / 2, xs: xs, xe: xe, y: mean - 2 * slope, space: slope });
      });
    }
    found.sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    var tracks = [];
    found.forEach(function (p) {
      var best = null, bd = 1e9;
      tracks.forEach(function (t) {
        var l = t.pts[t.pts.length - 1];
        if (p.x <= l.x) return;
        var d = Math.abs(p.y - l.y); if (d < 0.6 * sp0 + 0.02 * (p.x - l.x - stepW) && d < bd) { bd = d; best = t; }
      });
      if (best) best.pts.push(p); else tracks.push({ pts: [p] });
    });
    var staves = [];
    tracks.forEach(function (t) {
      if (t.pts.length < 2) return;
      var sps = t.pts.map(function (p) { return p.space; }).sort(function (a, b) { return a - b; });
      var st = { pts: t.pts, space: sps[sps.length >> 1], x0: t.pts[0].xs, x1: t.pts[t.pts.length - 1].xe };
      // the ends: walk outward while at least three of the five lines are there
      var has = function (xx) {
        var yt = topAt(st, xx), n = 0;
        for (var i = 0; i < 5; i++) { var r = Math.round(yt + i * st.space - 0.5), ok = 0; for (var q = r - 1; q <= r + 1; q++) if (q >= 0 && q < h && ink[q * w + xx]) ok = 1; n += ok; }
        return n >= 3;
      };
      var probe = function (from, dir) {
        var xx = from, miss = 0, lastOk = from;
        while (xx >= 0 && xx < w && miss < Math.max(3, sp0 * 0.6)) { if (has(xx)) { miss = 0; lastOk = xx; } else miss++; xx += dir; }
        return lastOk;
      };
      st.x0 = probe(Math.round(t.pts[0].x), -1); st.x1 = probe(Math.round(t.pts[t.pts.length - 1].x), 1);
      if (st.x1 - st.x0 > 8 * sp0) staves.push(st);
    });
    // two readings of the same five lines (one of them caught on a ledger line): keep the one seen in more slabs
    staves.sort(function (a, b) { return b.pts.length - a.pts.length; });
    var uniq = [];
    staves.forEach(function (st) {
      var xm = (Math.max(st.x0, 0) + st.x1) / 2;
      if (!uniq.some(function (q) { return Math.abs(topAt(q, xm) - topAt(st, xm)) < 3 * sp0 && Math.min(q.x1, st.x1) - Math.max(q.x0, st.x0) > 0; })) uniq.push(st);
    });
    uniq.sort(function (a, b) { return topAt(a, (a.x0 + a.x1) / 2) - topAt(b, (b.x0 + b.x1) / 2); });
    return uniq;
  }

  function topAt(st, x) {
    var p = st.pts, n = p.length;
    if (n === 1) return p[0].y;
    var i = 0; while (i < n - 2 && x > p[i + 1].x) i++;
    var a = p[i], b = p[i + 1], t = (x - a.x) / (b.x - a.x);
    if (t < -1) t = -1; if (t > 2) t = 2;
    return a.y + (b.y - a.y) * t;
  }

  /* Staves joined at the left by one line are played together: a system. */
  function groupSystems(staves, ink, w, h) {
    var systems = [], cur = null;
    staves.forEach(function (st, i) {
      st.index = i;
      var join = false;
      if (cur) {
        var prev = staves[i - 1];
        if (Math.abs(prev.x0 - st.x0) < 2 * st.space) {
          var ya = Math.round(topAt(prev, prev.x0) + 4 * prev.space), yb = Math.round(topAt(st, st.x0)), bestCol = 0;
          for (var x = Math.max(0, Math.round(st.x0 - 1.5 * st.space)); x <= Math.min(w - 1, st.x0 + 1.5 * st.space); x++) {
            var n = 0; for (var y = ya; y <= yb; y++) if (ink[y * w + x] || (x > 0 && ink[y * w + x - 1])) n++;
            bestCol = Math.max(bestCol, n / Math.max(1, yb - ya + 1));
          }
          join = bestCol > 0.85;
        }
      }
      if (join) cur.push(st); else { cur = [st]; systems.push(cur); }
      st.system = systems.length - 1; st.inSystem = cur.length - 1;
    });
    return systems;
  }

  /* ---------- the band along one staff ---------- */
  function cutBand(gray, w, h, st) {
    var k = st.space / SP, xLeft = st.x0 - 6 * st.space;
    var width = Math.ceil(((st.x1 - st.x0) + 12 * st.space) / k / 4) * 4;
    var out = new Float32Array(HEIGHT * width), n = Math.max(1, Math.min(4, Math.round(k)));
    function px(x, y) {                                             // bilinear, white outside
      if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return 255;
      var x0 = x | 0, y0 = y | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
      return (gray[y0 * w + x0] * (1 - fx) + gray[y0 * w + x1] * fx) * (1 - fy) + (gray[y1 * w + x0] * (1 - fx) + gray[y1 * w + x1] * fx) * fy;
    }
    var tops = new Float64Array(width);
    for (var u = 0; u < width; u++) {
      var xc = xLeft + (u + 0.5) * k, yt = topAt(st, xc); tops[u] = yt;
      for (var v = 0; v < HEIGHT; v++) {
        var yc = yt + (v + 0.5 - TOP) * k, s = 0;
        for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) s += px(xc + ((a + 0.5) / n - 0.5) * k - 0.5, yc + ((b + 0.5) / n - 0.5) * k - 0.5);
        out[v * width + u] = s / (n * n);
      }
    }
    // ink against paper, judged in stretches along the band
    var chunk = 384, nCh = Math.max(1, Math.round(width / chunk)), cw = width / nCh, paper = [], dark = [];
    for (var c = 0; c < nCh; c++) {
      var hist = new Uint32Array(256), u0 = Math.round(c * cw), u1 = Math.round((c + 1) * cw), tot = 0;
      for (v = 0; v < HEIGHT; v++) for (u = u0; u < u1; u++) { hist[Math.max(0, Math.min(255, Math.round(out[v * width + u])))]++; tot++; }
      var acc = 0, p85 = 255, p05 = 0, gotD = false, gotP = false;
      for (var i = 0; i < 256; i++) { acc += hist[i]; if (!gotD && acc >= tot * 0.005) { p05 = i; gotD = true; } if (!gotP && acc >= tot * 0.85) { p85 = i; gotP = true; } }
      paper.push(p85); dark.push(p05);
    }
    for (u = 0; u < width; u++) {
      var fc = (u + 0.5) / cw - 0.5, c0 = Math.max(0, Math.min(nCh - 1, Math.floor(fc))), c1 = Math.min(nCh - 1, c0 + 1), t = Math.max(0, Math.min(1, fc - c0));
      var pp = paper[c0] * (1 - t) + paper[c1] * t, dd = dark[c0] * (1 - t) + dark[c1] * t, rng = pp - dd;
      for (v = 0; v < HEIGHT; v++) { var q = rng < 12 ? 0 : (pp - out[v * width + u]) / rng; out[v * width + u] = q < 0 ? 0 : q > 1 ? 1 : q; }
    }
    // where the five lines really lie in the band, stretch by stretch: the marks are measured from them, not from the cut
    var stepC = 24, winC = 48, dys = [];
    for (var c0 = 0; c0 + winC <= width || !dys.length; c0 += stepC) {
      var cEnd = Math.min(width, c0 + winC), prof = new Float32Array(HEIGHT), bestD = 0, bestV = -1, scores = [];
      for (v = 0; v < HEIGHT; v++) { var sm = 0; for (u = c0; u < cEnd; u++) sm += out[v * width + u]; prof[v] = sm / (cEnd - c0); }
      for (var d = -5; d <= 5; d++) {
        var sc = 0; for (var li = 0; li < 5; li++) sc += prof[Math.round(TOP - 0.5 + li * SP) + d];
        scores.push(sc); if (sc > bestV) { bestV = sc; bestD = d; }
      }
      var frac = 0, bi = bestD + 5;
      if (bi > 0 && bi < 10) { var den = scores[bi - 1] + scores[bi + 1] - 2 * bestV; if (Math.abs(den) > 1e-6) frac = Math.max(-0.5, Math.min(0.5, 0.5 * (scores[bi - 1] - scores[bi + 1]) / den)); }
      dys.push({ u: (c0 + cEnd) / 2, d: bestV >= 2.0 ? bestD + frac : null });
      if (cEnd >= width) break;
    }
    var good = dys.filter(function (q) { return q.d !== null; });
    var dyAt = function (uu) {
      if (!good.length) return 0;
      if (uu <= good[0].u) return good[0].d; if (uu >= good[good.length - 1].u) return good[good.length - 1].d;
      var gi = 0; while (gi < good.length - 2 && uu > good[gi + 1].u) gi++;
      var ga = good[gi], gb = good[gi + 1]; return ga.d + (gb.d - ga.d) * (uu - ga.u) / (gb.u - ga.u);
    };
    return { data: out, width: width, k: k, xLeft: xLeft, tops: tops, dyAt: dyAt };
  }

  /* ---------- the network (the same arithmetic as the training code) ---------- */
  function Net(spec, buffer) {
    this.layers = {}; var self = this;
    spec.layers.forEach(function (L) {
      var per = L['in'] / L.groups;
      self.layers[L.name] = { L: L, w: new Float32Array(buffer, L.w, L.out * per * L.k * L.k), b: new Float32Array(buffer, L.b, L.out) };
    });
    this.blocks = spec.blocks; this.classes = spec.classes;
  }
  function conv(t, layer) {
    var L = layer.L, W = layer.w, B = layer.b, s = L.stride, d = L.dilation, k = L.k, pad = d * (k >> 1);
    var ih = t.h, iw = t.w, oh = Math.floor((ih + 2 * pad - d * (k - 1) - 1) / s) + 1, ow = Math.floor((iw + 2 * pad - d * (k - 1) - 1) / s) + 1;
    var out = new Float32Array(L.out * oh * ow), per = L['in'] / L.groups, opg = L.out / L.groups, src = t.data, plane = oh * ow, ip = ih * iw;
    for (var oc = 0; oc < L.out; oc++) {
      var o0 = oc * plane, g = (oc / opg) | 0, bias = B[oc];
      for (var i = 0; i < plane; i++) out[o0 + i] = bias;
      for (var ic = 0; ic < per; ic++) {
        var i0 = (g * per + ic) * ip;
        for (var ky = 0; ky < k; ky++) for (var kx = 0; kx < k; kx++) {
          var wv = W[((oc * per + ic) * k + ky) * k + kx]; if (wv === 0) continue;
          var dy = ky * d - pad, dx = kx * d - pad;
          var yA = Math.max(0, Math.ceil(-dy / s)), yB = Math.min(oh - 1, Math.floor((ih - 1 - dy) / s));
          var xA = Math.max(0, Math.ceil(-dx / s)), xB = Math.min(ow - 1, Math.floor((iw - 1 - dx) / s));
          for (var y = yA; y <= yB; y++) {
            var so = i0 + (y * s + dy) * iw + dx, po = o0 + y * ow;
            if (s === 1) for (var x = xA; x <= xB; x++) out[po + x] += wv * src[so + x];
            else for (x = xA; x <= xB; x++) out[po + x] += wv * src[so + x * s];
          }
        }
      }
    }
    if (L.relu) for (i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
    return { c: L.out, h: oh, w: ow, data: out };
  }
  function twoChannels(band, width) {
    var x = new Float32Array(2 * HEIGHT * width); x.set(band);
    for (var v = 0; v < HEIGHT; v++) { var r = -1 + 2 * v / (HEIGHT - 1); for (var u = 0; u < width; u++) x[HEIGHT * width + v * width + u] = r; }
    return x;
  }
  /* The fast way, when the WebAssembly runtime is on the page; otherwise the plain arithmetic below. Both give the same marks. */
  Net.prototype.run = async function (band, width) {
    if (this.session) {
      var res = await this.session.run({ band: new root.ort.Tensor('float32', twoChannels(band, width), [1, 2, HEIGHT, width]) });
      return { c: res.heat.dims[1], h: res.heat.dims[2], w: res.heat.dims[3], data: res.heat.data };
    }
    return this.forward(band, width);
  };
  Net.prototype.forward = function (band, width) {
    var x = twoChannels(band, width);
    var Ls = this.layers;
    var a = conv(conv({ c: 2, h: HEIGHT, w: width, data: x }, Ls.stem1a), Ls.stem1b);
    var b = conv(a, Ls.stem2);
    for (var i = 0; i < this.blocks; i++) {
      var y = conv(conv(b, Ls['b' + i + 'dw']), Ls['b' + i + 'pw']);
      for (var j = 0; j < y.data.length; j++) { var s = y.data[j] + b.data[j]; y.data[j] = s > 0 ? s : 0; }
      b = y;
    }
    var cat = new Float32Array((b.c + a.c) * a.h * a.w), plane = a.h * a.w;       // enlarge twice (nearest), then join with the fine layer
    for (var c = 0; c < b.c; c++) for (var yy = 0; yy < a.h; yy++) {
      var sy = Math.min(b.h - 1, yy >> 1) * b.w + c * b.h * b.w, o = c * plane + yy * a.w;
      for (var xx = 0; xx < a.w; xx++) cat[o + xx] = b.data[sy + Math.min(b.w - 1, xx >> 1)];
    }
    cat.set(a.data, b.c * plane);
    var t = { c: b.c + a.c, h: a.h, w: a.w, data: cat };
    t = conv(conv(conv(conv(conv(t, Ls.h1), Ls.h2), Ls.h3), Ls.h4), Ls.out);
    for (i = 0; i < t.data.length; i++) t.data[i] = 1 / (1 + Math.exp(-t.data[i]));
    return t;
  };

  function peaks(t, thr) {
    var out = [], h = t.h, w = t.w, d = t.data;
    for (var c = 0; c < Math.min(t.c, 13); c++) {
      var o = c * h * w;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var v = d[o + y * w + x]; if (v < thr) continue;
        var top = true;
        for (var dy = -1; dy <= 1 && top; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dy && !dx) continue;
          var yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          var q = d[o + yy * w + xx]; if (q > v || (q === v && (dy < 0 || (dy === 0 && dx < 0)))) { top = false; break; }
        }
        if (!top) continue;
        var g = function (yy, xx) { return (yy < 0 || xx < 0 || yy >= h || xx >= w) ? 0 : d[o + yy * w + xx]; };
        var off = function (a, b) { var den = a + b - 2 * v; if (Math.abs(den) < 1e-9) return 0; var r = 0.5 * (a - b) / den; return r < -0.5 ? -0.5 : r > 0.5 ? 0.5 : r; };
        out.push({ c: c, col: x + off(g(y, x - 1), g(y, x + 1)), row: y + off(g(y - 1, x), g(y + 1, x)), score: v });
      }
    }
    return out;
  }

  /* ---------- reasoning: from marks on a staff to notes ---------- */
  var GROUPS = [[0, 1, 2], [3, 4, 5, 6, 7], [8, 9, 10]];             // marks that cannot share a place: heads; accidentals; clefs
  function tidy(marks) {
    marks.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    marks.forEach(function (m) {
      var grp = GROUPS.filter(function (g) { return g.indexOf(m.c) >= 0; })[0];
      var clash = keep.some(function (q) {
        if (q.c !== m.c && !(grp && grp.indexOf(q.c) >= 0)) return false;
        var far = m.c >= 8 && m.c <= 10 ? 8 : m.c === 11 ? 3 : 1.6;
        return Math.abs(q.col - m.col) < far && Math.abs(q.row - m.row) < (m.c >= 8 ? 30 : m.c === 11 ? 30 : 1.6);
      });
      if (!clash) keep.push(m);
    });
    return keep;
  }
  function stepOf(row) { return Math.round((row * 2 + 0.5 - TOP) / 4); }       // 0 = top line, 1 = the space below it, ...
  /* A notehead's line or space. Far from the staff the height alone can mislead (ledger lines are often printed wider apart),
     so the eye also says whether a line runs through the head: of the two nearest places, take the one that agrees. */
  function headStep(m) {
    var f = (m.row * 2 + 0.5 - TOP) / 4, r = Math.round(f);
    if (m.onLine == null || (Math.abs(m.onLine - 0.5) < 0.2)) return r;
    var even = m.onLine > 0.5;
    if ((((r % 2) + 2) % 2 === 0) === even) return r;
    return f >= r ? r + 1 : r - 1;
  }
  function clefTop(c, row) {                                         // the note on the top line, as octave * 7 + letter
    if (c === 8) return 5 * 7 + 3;                                   // treble: F5
    if (c === 9) return 3 * 7 + 5;                                   // bass: A3
    var line = Math.round((row * 2 + 0.5 - TOP) / 8);                // C clef: middle C is the line it sits on
    if (line < 0) line = 0; if (line > 4) line = 4;
    return 4 * 7 + 2 * line;
  }
  /* A key signature: sharps or flats in their fixed order (F C G D A E B, or the reverse), close together, no note beside them. */
  function keyRun(accs, from, top, heads, atStart) {
    var first = accs[from]; if (!first || (first.c !== 3 && first.c !== 4 && first.c !== 5)) return null;
    var run = [], i = from, kind = null, naturals = 0, n = 0, skipped = 0;
    while (i < accs.length) {
      var a = accs[i];
      if (run.length && a.col - accs[i - 1].col > 13) break;          // more than about three spaces apart: not the same group
      if (a.c === 5 && !kind) { naturals++; i++; run.push(a); continue; }         // naturals cancel the old signature first
      if (a.c !== 3 && a.c !== 4) break;
      if (!kind) kind = a.c; else if (a.c !== kind) break;
      var order = kind === 3 ? SHARP_ORDER : FLAT_ORDER, letter = (((top - stepOf(a.row)) % 7) + 7) % 7;
      var at = -1;
      for (var q = n; q < Math.min(7, n + 3); q++) if (order[q] === letter) { at = q; break; }   // one or two of the group may have been missed by the eye
      if (at < 0) break;
      if (run.length) {                                               // neighbors in the order stand about a space apart; a missed one leaves a wider gap
        var gap = a.col - accs[i - 1].col, miss = at - n;
        if (gap > 6.5 + 4 * miss || (miss && gap < 2 + 4 * miss)) break;
      }
      skipped += at - n; n = at + 1;
      run.push(a); i++;
    }
    if (!run.length) return null;
    if (!kind && naturals < 1) return null;
    if (kind && skipped && run.length - naturals < 2 && !atStart) return null;    // mid-line, a lone sharp or flat that is not the first of the order is not a signature
    var lastA = run[run.length - 1];
    var beside = heads.some(function (hd) {                           // a note right beside the group means these are that note's accidentals
      var dx = hd.col - lastA.col; if (dx < 1 || dx > 8) return false;
      return run.some(function (r) { return Math.abs(r.row - hd.row) < 1.3; });
    });
    if (beside && run.length <= 2) return null;
    if (!kind) return { fifths: 0, used: run.length, end: lastA.col };
    return { fifths: kind === 3 ? n : -n, used: run.length, end: lastA.col };
  }
  var KEY_THR = 1;      // faint marks in the key-signature zone were tried at 0.1 and 0.2 on the development scans and made the reading worse; off
  function readStaff(marks, opts) {
    opts = opts || {};
    // faint marks are kept only where a key signature stands: sharps and flats before the first note of the line
    var thr = opts.thr || 0.3, firstHead = 1e9;
    marks.forEach(function (m) { if ((m.c <= 2 || m.c === 12) && m.score >= thr && m.col < firstHead) firstHead = m.col; });
    marks = marks.filter(function (m) { return m.score >= thr || ((m.c === 3 || m.c === 4) && m.col < firstHead - 4); });
    marks = tidy(marks);
    var heads = marks.filter(function (m) { return m.c <= 2; }), accs = marks.filter(function (m) { return m.c >= 3 && m.c <= 7; });
    var events = marks.filter(function (m) { return m.c !== 12; }).sort(function (a, b) { return a.col - b.col || a.row - b.row; });
    accs.sort(function (a, b) { return a.col - b.col; });
    var top = opts.top != null ? opts.top : 38, startTop = top, fifths = opts.fifths || 0, clefSeen = false, firstClef = null, startKey = null;
    var inBar = {}, notes = [], reasons = [], skip = new Set(), keyOpen = true;      // keyOpen: a key signature may begin here
    var keyAlter = function (letter) {
      if (fifths > 0 && SHARP_ORDER.slice(0, fifths).indexOf(letter) >= 0) return 1;
      if (fifths < 0 && FLAT_ORDER.slice(0, -fifths).indexOf(letter) >= 0) return -1;
      return 0;
    };
    // accidentals that belong to a note: the nearest note to the right on the same line or space
    var ownerOf = new Map();
    accs.forEach(function (a) {
      var best = null, bd = 1e9;
      heads.forEach(function (hd) { var dx = hd.col - a.col; if (dx > 1 && dx < 22 && Math.abs(hd.row - a.row) < 1.3 && dx < bd) { bd = dx; best = hd; } });
      if (best) ownerOf.set(a, best);
    });
    var headAcc = new Map();
    events.forEach(function (m, idx) {
      if (m.c >= 8 && m.c <= 10) {
        if (firstClef && !notes.length && m.col - firstClef.col < 40) return;       // nothing changes clef right after the clef (a time signature can look like one)
        top = clefTop(m.c, m.row); clefSeen = true; keyOpen = true;
        if (!firstClef) {
          firstClef = { c: m.c, top: top, col: m.col };
          if (!notes.length) { fifths = opts.forceKey != null ? opts.forceKey : 0; startKey = 0; }      // a new line of music states its key afresh
        }
        reasons.push({ col: m.col, what: 'clef', clef: CLASSES[m.c].slice(5), top: top });
        return;
      }
      if (m.c === 11) { inBar = {}; keyOpen = true; return; }
      if (m.c >= 3 && m.c <= 7) {
        if (skip.has(m)) return;
        if (keyOpen) {
          var ai = accs.indexOf(m), kr = keyRun(accs, ai, top, heads, notes.length === 0);
          if (kr) {
            for (var q = 0; q < kr.used; q++) skip.add(accs[ai + q]);
            keyOpen = false;
            if (notes.length === 0) { startKey = kr.fifths; fifths = opts.forceKey != null ? opts.forceKey : kr.fifths; } else fifths = kr.fifths;
            reasons.push({ col: m.col, what: 'key', fifths: fifths });
            return;
          }
        }
        var hd = ownerOf.get(m);
        if (hd) { var arr = headAcc.get(hd) || []; arr.push(m); headAcc.set(hd, arr); }
        return;
      }
      // a notehead
      keyOpen = false;
      var st = headStep(m), dia = top - st, letter = ((dia % 7) + 7) % 7, octave = Math.floor(dia / 7), alter, why;
      var own = headAcc.get(m);
      if (own && own.length) {
        var a = own[own.length - 1];
        alter = a.c === 3 ? 1 : a.c === 4 ? -1 : a.c === 5 ? 0 : a.c === 6 ? 2 : -2; inBar[st] = alter; why = 'printed';
      } else if (st in inBar) { alter = inBar[st]; why = 'bar'; }
      else { alter = keyAlter(letter); why = alter ? 'key' : 'plain'; }
      notes.push({ col: m.col, row: m.row, rawRow: m.rawRow, step: st, letter: letter, octave: octave, alter: alter, why: why, kind: CLASSES[m.c].slice(5), score: m.score,
        name: LETTERS[letter] + (alter === 1 ? '♯' : alter === -1 ? '♭' : alter === 2 ? '𝄪' : alter === -2 ? '𝄫' : ''), midi: 12 * (octave + 1) + SEMIS[letter] + alter });
    });
    return { notes: notes, marks: marks, reasons: reasons, firstClef: firstClef, startKey: startKey, startTop: startTop, endTop: top, endFifths: fifths, clefSeen: clefSeen };
  }

  /* ---------- a page ---------- */
  async function readPage(image, net, opts) {
    opts = opts || {};
    var w = image.width, h = image.height, gray = image.gray || toGray(image.data, w, h);
    var tick = opts.onProgress || function () {}, pause = opts.pause || function () { return Promise.resolve(); };
    var ink = binarize(gray, w, h), ls = lineSpacing(ink, w, h);
    if (!ls) return { width: w, height: h, staves: [], notes: [], systems: 0, problem: 'no staff lines found' };
    var staves = findStaves(ink, w, h, ls.space, ls.thick), systems = groupSystems(staves, ink, w, h);
    var carry = opts.carry || {}, out = [], allNotes = [], thr = opts.threshold || 0.3;
    for (var si = 0; si < staves.length; si++) {
      var st = staves[si];
      tick(si, staves.length); await pause();
      var band = cutBand(gray, w, h, st), heat = await net.run(band.data, band.width), marks = peaks(heat, Math.min(thr, KEY_THR));
      if (heat.c > 13) marks.forEach(function (m) {                   // does a line run through this notehead?
        if (m.c > 2) return;
        var r0 = Math.round(m.row), c0 = Math.round(m.col), best = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var yy = r0 + dy, xx = c0 + dx; if (yy < 0 || xx < 0 || yy >= heat.h || xx >= heat.w) continue;
          best = Math.max(best, heat.data[13 * heat.h * heat.w + yy * heat.w + xx]);
        }
        m.onLine = best;
      });
      marks.forEach(function (m) { m.rawRow = m.row; m.row = m.row - band.dyAt(m.col * 2 + 0.5) / 2; });
      st.band = { width: band.width, k: band.k, xLeft: band.xLeft }; st.marks = marks; st._tops = band.tops;
    }
    // read system by system; a staff that shows no clef or key keeps the ones it had in the system above
    var vote = function (ks, before) {
      if (!ks.length) return null;
      var count = function (v) { return ks.filter(function (q) { return q === v; }).length; }, known = function (v) { return before.indexOf(v) >= 0 ? 1 : 0; };
      return ks.slice().sort(function (a, b) { return count(b) - count(a) || known(b) - known(a) || Math.abs(b) - Math.abs(a); })[0];
    };
    // a first look at the key signature each system shows, so that one misread line can be set right by the lines around it
    var rawKeys = systems.map(function (sys) {
      return vote(sys.map(function (st) { return readStaff(st.marks.slice(), { thr: thr }).startKey; }).filter(function (k) { return k !== null; }), []);
    });
    systems.forEach(function (sys, sn) {
      var reads = sys.map(function (st) {
        var prev = carry[sys.length + ':' + st.inSystem] || {};
        return readStaff(st.marks.slice(), { thr: thr, top: prev.top, fifths: prev.fifths });
      });
      // a pair of staves with one clef unread and nothing remembered: assume the usual piano pair (treble above, bass below)
      if (sys.length === 2) sys.forEach(function (st, j) {
        var prev = carry['2:' + st.inSystem] || {};
        if (!reads[j].firstClef && prev.top == null && reads[1 - j].firstClef) reads[j] = readStaff(st.marks.slice(), { thr: thr, top: j === 0 ? 38 : 26, fifths: prev.fifths, assumed: true });
      });
      // the key signature is the same on every staff of a system: if one staff disagrees at the start, re-read it with the common one
      var ks = reads.map(function (r) { return r.startKey; }).filter(function (k) { return k !== null; });
      var common = vote(ks, sys.map(function (st) { return (carry[sys.length + ':' + st.inSystem] || {}).fifths; }));
      // the key holds from line to line unless a change is printed: a line that differs from the one before and the one after is a misreading
      if (carry.endKey != null && common !== carry.endKey && (common === null || rawKeys[sn + 1] === carry.endKey)) common = carry.endKey;
      sys.forEach(function (st, j) {
        var r = reads[j];
        if (common !== null && r.startKey !== common) {
          var prev = carry[sys.length + ':' + st.inSystem] || {};
          r = reads[j] = readStaff(st.marks.slice(), { thr: thr, top: r.firstClef ? prev.top : r.startTop, fifths: common, forceKey: common });
        }
        carry[sys.length + ':' + st.inSystem] = { top: r.endTop, fifths: r.endFifths };
        if (j === 0) carry.endKey = r.endFifths;
        var toPage = function (m) {
          var u = m.col * 2 + 0.5, v = (m.rawRow != null ? m.rawRow : m.row) * 2 + 0.5, x = st.band.xLeft + u * st.band.k;
          return { x: x, y: topAt(st, x) + (v - TOP) * st.band.k };
        };
        r.notes.forEach(function (n) { var p = toPage(n); n.x = p.x; n.y = p.y; n.staff = st.index; n.system = sn; n.space = st.space; allNotes.push(n); });
        r.marks.forEach(function (m) { var p = toPage(m); m.x = p.x; m.y = p.y; m.kind = CLASSES[m.c]; });
        out.push({ index: st.index, system: sn, x0: st.x0, x1: st.x1, space: st.space, top: topAt(st, st.x0), topEnd: topAt(st, st.x1),
          marks: r.marks, reasons: r.reasons, clef: r.firstClef, key: r.startKey });
      });
    });
    tick(staves.length, staves.length);
    return { width: w, height: h, space: ls.space, staves: out, notes: allNotes, systems: systems.length, carry: carry };
  }

  async function loadNet(base, opts) {
    opts = opts || {};
    var spec = await (await fetch(base + 'reader.json')).json(), buf = await (await fetch(base + 'reader.bin')).arrayBuffer();
    var net = new Net(spec, buf); net.engine = 'plain';
    if (root.ort && !opts.plain) {
      try {
        if (opts.wasm) root.ort.env.wasm.wasmPaths = opts.wasm;
        root.ort.env.wasm.numThreads = root.crossOriginIsolated ? Math.min(4, (root.navigator && root.navigator.hardwareConcurrency) || 1) : 1;
        net.session = await root.ort.InferenceSession.create(base + 'reader.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
        net.engine = 'wasm';
      } catch (e) { net.session = null; net.engineError = String(e); }
    }
    return net;
  }

  root.ColorKeyReader = { version: '0.1.0', loadNet: loadNet, Net: Net, readPage: readPage, toGray: toGray, binarize: binarize, lineSpacing: lineSpacing,
    findStaves: findStaves, groupSystems: groupSystems, cutBand: cutBand, peaks: peaks, readStaff: readStaff, topAt: topAt, CLASSES: CLASSES, LETTERS: LETTERS };
})(typeof window !== 'undefined' ? window : globalThis);
