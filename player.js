/* Hearing the score.
   The page plays the notes it read: every sounding note of the score (ties joined, transposing instruments at the pitch
   they sound) at its moment, with tones made here in the browser by the Web Audio interface. No recording and no sample
   is fetched; nothing leaves the device.

   What it follows in the score (0.2.0): repeats with their first and second endings; every tempo the score gives; the
   dynamics written in each part (pp to ff); the sustaining pedal. Each part gets a tone that fits its name (a violin a
   bowed tone, a flute a breathy one, a piano a struck one), or the listener chooses one tone for everything.
   What it does not: da capo and dal segno, hairpins, accents and articulation, rubato. The tones are built from
   overtones, a moving filter and a little room sound; they are not recordings of instruments. */
(function (root) {
  "use strict";
  /* The tones. body: strength of the first harmonics. bright: the harmonics that die away first (a struck or plucked
     string) or that come with loudness. struck: seconds for the tone to fall to a third by itself; 0 holds while the note lasts. */
  var SOUNDS = {
    piano:   { name: "Piano",   body: [1, 0.55, 0.3, 0.14, 0.08, 0.04], bright: [0.2, 0.5, 0.6, 0.5, 0.42, 0.34, 0.26, 0.2, 0.14, 0.1, 0.07, 0.05], attack: 0.004, struck: 1.1, release: 0.14, gain: 1.0, spread: 1.5, sweep: [9, 2.4] },
    strings: { name: "Strings", body: [1, 0.7, 0.5, 0.36, 0.27, 0.2, 0.15, 0.11, 0.08, 0.06, 0.04, 0.03], attack: 0.09, struck: 0, release: 0.18, vibrato: 5.3, gain: 0.5, spread: 7, sweep: [3.2, 5.5] },
    winds:   { name: "Winds",   body: [1, 0.18, 0.42, 0.07, 0.14, 0.03, 0.05], attack: 0.05, struck: 0, release: 0.1, vibrato: 4.7, gain: 0.8, spread: 0, sweep: [3, 4.5] },
    brass:   { name: "Brass",   body: [1, 0.85, 0.7, 0.55, 0.42, 0.3, 0.2, 0.13, 0.08], attack: 0.05, struck: 0, release: 0.12, gain: 0.55, spread: 0, sweep: [1.6, 5] },
    organ:   { name: "Organ",   body: [1, 0.7, 0.2, 0.5, 0, 0.18, 0, 0.25], attack: 0.025, struck: 0, release: 0.08, gain: 0.55, spread: 2, sweep: [6, 6] },
    plucked: { name: "Plucked", body: [1, 0.6, 0.35, 0.2, 0.1], bright: [0.3, 0.6, 0.6, 0.5, 0.4, 0.3, 0.22, 0.15, 0.1], attack: 0.002, struck: 0.5, release: 0.09, gain: 0.9, spread: 0, sweep: [10, 2] },
    voice:   { name: "Voices",  body: [1, 0.5, 0.55, 0.2, 0.1, 0.05], attack: 0.07, struck: 0, release: 0.14, vibrato: 5.0, gain: 0.65, spread: 5, sweep: [3, 4] }
  };
  var ORDER = ["piano", "strings", "winds", "brass", "organ", "plucked", "voice"];
  var LOUD = { pppp: 0.28, ppp: 0.33, pp: 0.42, p: 0.54, mp: 0.67, mf: 0.8, f: 0.94, ff: 1.08, fff: 1.2, ffff: 1.28, fp: 0.54, sf: 0.94, sfz: 0.94, fz: 0.94, sfp: 0.54, rf: 0.94, rfz: 0.94 };

  /* Which tone fits a part, from its name in the score. */
  function soundFor(name) {
    var n = String(name || "").toLowerCase();
    if (/organ|orgel|harmonium/.test(n)) return "organ";
    if (/harpsi|cembalo|guitar|gitarre|harp|harfe|lute|mandolin|banjo|ukulele|pizz/.test(n)) return "plucked";
    if (/piano|klavier|keyboard|celesta|staff \d/.test(n)) return "piano";
    if (/violin|viola|cello|bass viol|contrabass|double bass|kontrabass|bratsche|geige|string|streich|fiddle/.test(n)) return "strings";
    if (/flute|flöte|piccolo|oboe|clarinet|klarinette|bassoon|fagott|sax|recorder|english horn|cor anglais|wind/.test(n)) return "winds";
    if (/horn|trumpet|trompete|trombone|posaune|tuba|cornet|brass|euphonium/.test(n)) return "brass";
    if (/voice|vocal|soprano|sopran|alto|tenor|baritone|bariton|bass\b|choir|chor|mezzo|sing/.test(n)) return "voice";
    return "piano";
  }

  /* ---------- what the score says about how to play it ---------- */
  var kids = function (el, tag) { return Array.prototype.filter.call(el.children, function (c) { return c.localName === tag; }); };
  /* Walks every part bar by bar and collects, with their place in quarter notes: tempos, dynamics, pedal marks, and for
     each bar its repeat signs and endings. Returns null when the file's bars are not the bars the engine counted. */
  function marks(score) {
    var doc = score.doc, parts = doc ? kids(doc.documentElement, "part") : [], M = score.measures || [];
    if (!parts.length || !M.length) return null;
    var out = { tempo: [], dyn: {}, pedal: {}, bars: M.map(function () { return { forward: false, backward: 0, endings: null }; }), ok: true };
    parts.forEach(function (part) {
      var pid = part.getAttribute("id"), ms = kids(part, "measure"), div = 1;
      if (ms.length !== M.length) { out.ok = false; return; }
      out.dyn[pid] = []; out.pedal[pid] = [];
      ms.forEach(function (m, i) {
        var pos = 0, start = M[i].start.num(), bar = out.bars[i];
        Array.prototype.forEach.call(m.children, function (el) {
          var tag = el.localName, at = function () { return start + pos / div; };
          if (tag === "attributes") { var d = kids(el, "divisions")[0]; if (d && +d.textContent > 0) div = +d.textContent; }
          else if (tag === "note") { if (!kids(el, "chord").length && !kids(el, "grace").length) { var du = kids(el, "duration")[0]; pos += du ? +du.textContent : 0; } }
          else if (tag === "backup") pos -= +(kids(el, "duration")[0] || {}).textContent || 0;
          else if (tag === "forward") pos += +(kids(el, "duration")[0] || {}).textContent || 0;
          else if (tag === "direction" || tag === "sound") {
            var snd = tag === "sound" ? [el] : kids(el, "sound");
            snd.forEach(function (s) {
              if (+s.getAttribute("tempo") > 0) out.tempo.push({ q: at(), bpm: +s.getAttribute("tempo") });
              if (+s.getAttribute("dynamics") > 0) out.dyn[pid].push({ q: at(), v: Math.max(0.25, Math.min(1.3, +s.getAttribute("dynamics") / 90 * 0.94)), soft: true });
            });
            Array.prototype.forEach.call(el.getElementsByTagName("dynamics"), function (dy) { var k = dy.firstElementChild && dy.firstElementChild.localName; if (LOUD[k]) out.dyn[pid].push({ q: at(), v: LOUD[k] }); });
            Array.prototype.forEach.call(el.getElementsByTagName("pedal"), function (pd) { out.pedal[pid].push({ q: at(), type: pd.getAttribute("type") }); });
            if (!snd.some(function (s) { return +s.getAttribute("tempo") > 0; })) {
              var mm = el.getElementsByTagName("per-minute")[0];
              if (mm && parseFloat(mm.textContent) > 0) { var unit = (el.getElementsByTagName("beat-unit")[0] || {}).textContent || "quarter", dot = el.getElementsByTagName("beat-unit-dot").length; out.tempo.push({ q: at(), bpm: parseFloat(mm.textContent) * ({ whole: 4, half: 2, quarter: 1, eighth: 0.5, "16th": 0.25 }[unit] || 1) * (dot ? 1.5 : 1) }); }
            }
          } else if (tag === "barline") {
            var rp = kids(el, "repeat")[0], en = kids(el, "ending")[0];
            if (rp && rp.getAttribute("direction") === "forward") bar.forward = true;
            if (rp && rp.getAttribute("direction") === "backward") bar.backward = Math.max(2, parseInt(rp.getAttribute("times") || "2", 10) || 2);
            if (en && en.getAttribute("type") === "start") bar.endings = String(en.getAttribute("number") || "1").split(/[,\s]+/).map(Number).filter(function (x) { return x > 0; });
          }
        });
      });
    });
    if (!out.ok) return null;
    // an ending holds until its last bar (the one that is marked as its stop), so the bars between carry it too
    parts.slice(0, 1).forEach(function (part) {
      var cur = null;
      kids(part, "measure").forEach(function (m, i) {
        var stops = false;
        kids(m, "barline").forEach(function (b) { var en = kids(b, "ending")[0]; if (en && en.getAttribute("type") === "start") cur = out.bars[i].endings; if (en && /stop|discontinue/.test(en.getAttribute("type"))) stops = true; });
        if (cur && !out.bars[i].endings) out.bars[i].endings = cur;
        if (stops) cur = null;
      });
    });
    out.tempo.sort(function (a, b) { return a.q - b.q; });
    return out;
  }
  /* The order in which the bars are played: repeats taken, each ending in its turn. */
  function barOrder(bars) {
    var n = bars.length, order = [], i = 0, from = 0, pass = 1, taken = {}, fresh = false, guard = 0;
    while (i < n && guard++ < 6 * n + 50) {
      var b = bars[i];
      if (b.forward && from !== i) { from = i; pass = 1; fresh = false; }
      if (fresh && !b.endings) { pass = 1; fresh = false; }
      if (b.endings && b.endings.indexOf(pass) < 0) { i += 1; continue; }
      order.push(i);
      if (b.backward && (taken[i] || 0) < b.backward - 1) { taken[i] = (taken[i] || 0) + 1; pass += 1; i = from; continue; }
      if (b.backward) { from = i + 1; fresh = true; }
      i += 1;
    }
    return order;
  }

  /* The notes to play, in seconds from the start, from a score as engine/colorkey.js reads it.
     opts: { bpm (quarter notes a minute at the start), sound ("written" or one of the tones), plain (true: no repeats, tempos,
     dynamics or pedal: the bare notes) }. Returns { list, total, where(sec) -> { q, bar } }. */
  function plan(score, opts) {
    opts = opts || {};
    var M = score.measures || [], mk = opts.plain ? null : marks(score), partName = {};
    (score.parts || []).forEach(function (p) { partName[p.id] = p.name; });
    var order = mk ? barOrder(mk.bars) : M.map(function (_m, i) { return i; });
    var tempos = mk && mk.tempo.length ? mk.tempo : [], first = tempos.length ? tempos[0].bpm : null, scale = first ? (opts.bpm || first) / first : 1;
    var bpmAt = function (q) { var b = first || opts.bpm || 96; for (var i = 0; i < tempos.length && tempos[i].q <= q + 1e-9; i++) b = tempos[i].bpm; return first ? b * scale : (opts.bpm || 96); };
    var span = function (q0, q1) {                 // seconds from q0 to q1 of the score, through every change of tempo between them
      var s = 0, at = q0; for (var i = 0; i < tempos.length; i++) { var c = tempos[i].q; if (c > at + 1e-9 && c < q1 - 1e-9) { s += (c - at) * 60 / bpmAt(at); at = c; } }
      return s + (q1 - at) * 60 / bpmAt(at);
    };
    var starts = M.map(function (m) { return m.start.num(); }), ends = M.map(function (m) { return m.end.num(); });
    var byBar = M.map(function () { return []; });
    (score.sounding || []).forEach(function (e) {
      var s = e.start.num(), en = e.end.num(); if (!(en > s) || !e.pitch || !isFinite(e.pitch.midi)) return;
      var lo = 0, hi = starts.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (starts[mid] <= s + 1e-9) lo = mid + 1; else hi = mid; }
      var pid = String(e.partId).replace(/-Staff\d+$/, ""); if (lo - 1 >= 0) byBar[lo - 1].push({ s: s, e: en, midi: e.pitch.midi, pid: pid });
    });
    var loud = function (pid, q) { var d = mk && mk.dyn[pid], v = 0.8; if (d) for (var i = 0; i < d.length && d[i].q <= q + 1e-9; i++) v = d[i].v; return v; };
    var held = function (pid, s, en) {            // the pedal is down when the note starts: it sounds until the pedal comes up
      var p = mk && mk.pedal[pid]; if (!p || !p.length) return en;
      var down = false, up = en; for (var i = 0; i < p.length; i++) { if (p[i].q <= s + 1e-9) down = p[i].type !== "stop"; else if (down && (p[i].type === "stop" || p[i].type === "change")) { up = p[i].q; break; } else if (!down) break; }
      return down ? Math.min(Math.max(en, up), s + 12) : en;
    };
    var list = [], sec = 0, table = [];
    order.forEach(function (i) {
      table.push({ sec: sec, bar: i });
      byBar[i].forEach(function (n) {
        var pid = n.pid, end = held(pid, n.s, n.e);
        list.push({ t: sec + span(starts[i], n.s), d: span(n.s, end), midi: n.midi, q: n.s, part: pid, vel: loud(pid, n.s),
          sound: opts.sound && opts.sound !== "written" && SOUNDS[opts.sound] ? opts.sound : soundFor(partName[pid]) });
      });
      sec += span(starts[i], ends[i]);
    });
    list.sort(function (a, b) { return a.t - b.t || a.midi - b.midi; });
    var total = list.length ? Math.max(sec, Math.max.apply(null, list.map(function (e) { return e.t + e.d; }))) : 0;
    return { list: list, total: total, bars: M.length, order: order, repeats: order.length !== M.length, tempos: tempos.length, dynamics: !!(mk && Object.keys(mk.dyn).some(function (k) { return mk.dyn[k].length; })),
      where: function (t) { var k = 0; for (var j = 0; j < table.length; j++) if (table[j].sec <= t + 1e-6) k = j; var row = table[k] || { sec: 0, bar: 0 }; return { bar: row.bar + 1, q: Math.min(ends[row.bar], starts[row.bar] + (t - row.sec) * bpmAt(starts[row.bar]) / 60) }; } };
  }
  function events(score, opts) { return plan(score, opts).list; }
  /* The tempo the score itself gives (its first), or null. */
  function tempoOf(score) { var mk = marks(score); return mk && mk.tempo.length ? Math.round(mk.tempo[0].bpm) : null; }

  /* ---------- the sound ---------- */
  var waves = new WeakMap();
  function waveOf(ctx, key, which) {
    var per = waves.get(ctx); if (!per) { per = {}; waves.set(ctx, per); }
    var id = key + "|" + which;
    if (!per[id]) { var p = SOUNDS[key][which], re = new Float32Array(p.length + 1), im = new Float32Array(p.length + 1); p.forEach(function (v, i) { im[i + 1] = v; }); per[id] = ctx.createPeriodicWave(re, im); }
    return per[id];
  }
  /* One note into a context (the page's, or an offline one for a check). A struck tone starts bright and dulls as it dies,
     as a string does; a held tone opens up as it swells; two voices a few cents apart keep it from sounding like a test tone. */
  function schedule(ctx, dest, ev, when) {
    var key = ev.sound in SOUNDS ? ev.sound : "piano", S = SOUNDS[key], f = 440 * Math.pow(2, (ev.midi - 69) / 12), vel = ev.vel || 0.8;
    var g = ctx.createGain(), lp = ctx.createBiquadFilter(), t0 = when, t1 = when + Math.max(0.05, ev.d), end = t1 + S.release + (S.struck ? 0.25 : 0);
    var peak = 0.15 * S.gain * vel * Math.min(1.25, Math.max(0.55, 1.15 - (ev.midi - 60) / 90));
    var tau = S.struck ? S.struck * Math.min(2.4, Math.max(0.4, Math.pow(2, (60 - ev.midi) / 22))) : 0;
    var top = Math.min(14000, Math.max(700, f * S.sweep[0] * (0.6 + 0.5 * vel))), rest = Math.min(12000, Math.max(500, f * S.sweep[1]));
    lp.type = "lowpass"; lp.Q.value = 0.4; lp.frequency.setValueAtTime(top, t0);
    if (S.struck) lp.frequency.setTargetAtTime(rest, t0 + 0.01, tau * 0.45); else lp.frequency.linearRampToValueAtTime(rest * (0.7 + 0.4 * vel), t0 + S.attack * 2.5);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(peak, t0 + S.attack);
    if (S.struck) { g.gain.setTargetAtTime(peak * 0.03, t0 + S.attack, tau); g.gain.setTargetAtTime(0.0001, t1, S.release / 2.5); }
    else { g.gain.setTargetAtTime(peak * 0.86, t0 + S.attack, 0.25); g.gain.setTargetAtTime(0.0001, t1, S.release / 3); }
    var voices = S.spread ? [-S.spread, S.spread] : [0], oscs = [];
    voices.forEach(function (cents) { var o = ctx.createOscillator(); o.setPeriodicWave(waveOf(ctx, key, "body")); o.frequency.value = f; o.detune.value = cents; var vg = ctx.createGain(); vg.gain.value = voices.length > 1 ? (cents < 0 ? 0.78 : 0.36) : 1;   /* unequal, so that the two never cancel each other */ o.connect(vg); vg.connect(lp); oscs.push(o); });
    if (S.bright) {                                 // the upper harmonics of a struck string: loud at the blow, gone in a fraction of the tone's life
      var ob = ctx.createOscillator(), bg = ctx.createGain(); ob.setPeriodicWave(waveOf(ctx, key, "bright")); ob.frequency.value = f * (1 + 0.0004 * Math.max(0, ev.midi - 48));
      bg.gain.setValueAtTime(0.55 * vel, t0); bg.gain.setTargetAtTime(0.0001, t0 + 0.005, Math.max(0.05, tau * 0.22)); ob.connect(bg); bg.connect(lp); oscs.push(ob);
    }
    if (S.vibrato && ev.d > 0.4) { var v = ctx.createOscillator(), vd = ctx.createGain(); v.frequency.value = S.vibrato; vd.gain.setValueAtTime(0, t0); vd.gain.setValueAtTime(0, t0 + 0.18); vd.gain.linearRampToValueAtTime(f * 0.0045, t0 + 0.5); v.connect(vd); oscs.forEach(function (o) { vd.connect(o.frequency); }); v.start(t0); v.stop(end + 0.05); }
    lp.connect(g); g.connect(dest); oscs.forEach(function (o) { o.start(t0); o.stop(end + 0.05); });
  }
  /* A little room around the tones: the echo of a short burst of noise that dies away, made once. */
  function room(ctx) {
    var len = Math.floor(ctx.sampleRate * 1.7), buf = ctx.createBuffer(2, len, ctx.sampleRate), seed = 20261006;
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 4294967296 * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < 400 ? i / 400 : 1); } }
    var c = ctx.createConvolver(); c.buffer = buf; return c;
  }

  /* ---------- the player: one for the whole page, so that two scores never play at once ---------- */
  var P = { ctx: null, out: null, room: null, timer: null, state: "stopped", owner: null };
  function stop() {
    if (P.timer) { clearInterval(P.timer); P.timer = null; }
    if (P.out) { try { P.out.gain.cancelScheduledValues(0); P.out.gain.setValueAtTime(0, P.ctx.currentTime); P.out.disconnect(); } catch (e) { /* already gone */ } P.out = null; }
    if (P.ctx && P.ctx.state === "suspended") { try { P.ctx.resume(); } catch (e) { /* closed */ } }
    var was = P.owner; P.state = "stopped"; P.owner = null; if (was && was.sync) was.sync(); if (was && was.onStop) was.onStop();
  }
  function play(pl, owner, onTick) {
    stop();
    var AC = root.AudioContext || root.webkitAudioContext; if (!AC) throw new Error("this browser cannot make sound");
    if (!P.ctx) P.ctx = new AC();
    if (P.ctx.state === "suspended") P.ctx.resume();
    var comp = P.ctx.createDynamicsCompressor(), out = P.ctx.createGain(), wet = P.ctx.createGain(); out.gain.value = 0.9; wet.gain.value = 0.2;
    if (!P.room) { try { P.room = room(P.ctx); } catch (e) { P.room = null; } }
    out.connect(comp); if (P.room) { out.connect(P.room); P.room.connect(wet); wet.connect(comp); } comp.connect(P.ctx.destination);
    var list = pl.list, i = 0, t0 = P.ctx.currentTime + 0.12; P.out = out; P.state = "playing"; P.owner = owner;
    var step = function () {
      if (P.out !== out) return;
      var now = P.ctx.currentTime;
      while (i < list.length && t0 + list[i].t < now + 0.3) { var ev = list[i++]; schedule(P.ctx, out, ev, Math.max(now, t0 + ev.t)); }
      if (onTick) onTick(Math.max(0, now - t0));
      if (now - t0 > pl.total + 1.2) { try { wet.disconnect(); } catch (e) { /* gone */ } stop(); }
    };
    step(); P.timer = setInterval(step, 40);
  }
  function pause() { if (P.state === "playing" && P.ctx) { P.ctx.suspend(); P.state = "paused"; if (P.owner && P.owner.sync) P.owner.sync(); } }
  function resume() { if (P.state === "paused" && P.ctx) { P.ctx.resume(); P.state = "playing"; if (P.owner && P.owner.sync) P.owner.sync(); } }

  /* The controls for one score. getScore: () => the score to play, or a promise of it (null when there is none yet).
     opts.onPlace(q, bar): called while it plays with the place in the score (quarter notes from its start; the bar's number);
     opts.onStop(): called when it stops. Returns the element to put on the page. */
  function controls(getScore, opts) {
    opts = opts || {};
    var el = document.createElement("div"); el.className = "player"; el.setAttribute("role", "group"); el.setAttribute("aria-label", "Listen");
    // the icons are drawn, not fetched; the word beside each stays the button's name
    var ICON = { play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor"/></svg>',
      pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.8" width="3.2" height="10.4" rx="1" fill="currentColor"/><rect x="9.3" y="2.8" width="3.2" height="10.4" rx="1" fill="currentColor"/></svg>',
      stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>' };
    el.innerHTML = '<button class="btn solid p-play" type="button" data-p="play" aria-pressed="false" title="Play or pause (space bar)"><span class="p-ic">' + ICON.play + '</span><span class="p-w">Play</span></button>'
      + '<button class="btn p-stop" type="button" data-p="stop" disabled><span class="p-ic">' + ICON.stop + '</span><span class="p-w">Stop</span></button>'
      + '<span class="player-track" aria-hidden="true"><i data-p="prog"></i></span>'
      + '<label>Sound <select data-p="sound"><option value="written">As written</option>' + ORDER.map(function (k) { return '<option value="' + k + '">' + SOUNDS[k].name + "</option>"; }).join("") + "</select></label>"
      + '<label>Tempo <input type="range" data-p="bpm" min="30" max="220" step="2" value="96"> <output data-p="bpmOut">96</output></label>'
      + '<span class="player-at" data-p="at" role="status"></span>';
    var q = function (k) { return el.querySelector('[data-p="' + k + '"]'); }, me = { sync: null, onStop: opts.onStop || null }, touched = false, score = null;
    me.sync = function () {
      var mine = P.owner === me, st = mine ? P.state : "stopped";
      q("play").querySelector(".p-w").textContent = st === "playing" ? "Pause" : st === "paused" ? "Go on" : "Play"; q("play").setAttribute("aria-pressed", String(st === "playing"));
      q("play").querySelector(".p-ic").innerHTML = st === "playing" ? ICON.pause : ICON.play;
      q("stop").disabled = st === "stopped"; if (st === "stopped") { q("at").textContent = ""; q("prog").style.transform = "scaleX(0)"; }
      el.classList.toggle("on", st !== "stopped");
    };
    var start = async function () {
      q("play").disabled = true;
      try {
        score = await getScore();
        if (!score) { q("at").textContent = "Nothing to play yet."; return; }
        if (!touched) { var t = tempoOf(score); if (t) { q("bpm").value = Math.max(30, Math.min(220, t)); q("bpmOut").textContent = q("bpm").value; } }
        var pl = plan(score, { bpm: +q("bpm").value, sound: q("sound").value });
        if (!pl.list.length) { q("at").textContent = "Nothing to play yet."; return; }
        play(pl, me, function (sec) {
          var w = pl.where(Math.min(sec, pl.total));
          q("prog").style.transform = "scaleX(" + (pl.total > 0 ? Math.min(1, sec / pl.total) : 0).toFixed(4) + ")";
          q("at").textContent = "Bar " + w.bar + " of " + pl.bars + (pl.repeats ? ", with repeats" : ""); if (opts.onPlace) { try { opts.onPlace(w.q, w.bar); } catch (e) { /* the mark is a nicety */ } }
        });
        me.sync();
      } catch (e) { console.error(e); q("at").textContent = "The sound could not be started in this browser."; }
      finally { q("play").disabled = false; }
    };
    q("play").addEventListener("click", function () { if (P.owner === me && P.state === "playing") pause(); else if (P.owner === me && P.state === "paused") resume(); else start(); });
    q("stop").addEventListener("click", stop);
    q("bpm").addEventListener("input", function () { touched = true; q("bpmOut").textContent = q("bpm").value; });
    var again = function () { if (P.owner === me && P.state !== "stopped") start(); };       // a new tone or tempo: from the top with it
    q("bpm").addEventListener("change", again); q("sound").addEventListener("change", again);
    el.reset = function () { if (P.owner === me) stop(); touched = false; q("bpm").value = 96; q("bpmOut").textContent = "96"; me.sync(); };
    return el;
  }

  /* A few chords one after another, each struck together, for the chord card ("hear it", "hear where it goes").
     groups: [[midi, ...], ...]; opts: { sound, dur (seconds a chord), roll (seconds between the notes of one chord, low to high),
     onStop }. Uses the one player of the page, so a score that was playing stops. Returns false when there is nothing to play. */
  function chords(groups, opts) {
    opts = opts || {};
    var dur = opts.dur || 1.15, roll = opts.roll == null ? 0.012 : opts.roll, list = [], sound = SOUNDS[opts.sound] ? opts.sound : "piano";
    (groups || []).forEach(function (g, k) {
      var notes = (g || []).filter(function (m) { return isFinite(m); }).slice().sort(function (a, b) { return a - b; });
      notes.forEach(function (m, n) { list.push({ t: k * dur + n * roll, d: dur * (k === groups.length - 1 ? 1.5 : 0.92), midi: m, q: k, part: "", vel: 0.78, sound: sound }); });
    });
    if (!list.length) return false;
    var total = Math.max.apply(null, list.map(function (e) { return e.t + e.d; }));
    play({ list: list, total: total, where: function () { return { bar: 1, q: 0 }; } }, { sync: null, onStop: opts.onStop || null }, null);
    return true;
  }

  root.ColorKeyPlayer = { version: "0.3.0", SOUNDS: SOUNDS, soundFor: soundFor, marks: marks, barOrder: barOrder, plan: plan, events: events, tempoOf: tempoOf, schedule: schedule, controls: controls, chords: chords, stop: stop, state: function () { return P.state; } };
})(typeof window !== "undefined" ? window : globalThis);
