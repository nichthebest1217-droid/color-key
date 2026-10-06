/* Color Key: "Make it yours". A visitor's own colors, names and readings.
   Everything is kept in this browser under one localStorage key and nowhere else: this file makes no request and puts nothing in the address.
   It draws nothing in the score. It hands app.js a language (the published one, a color set, the visitor's changes) and lays the visitor's
   readings on the chords app.js has analyzed; app.js draws. Without this file the page is the page as published.

   window.CKStudio
     init({ base, palettes, dict })       given by app.js when its data has loaded (base: data/language.json, never edited; palettes: data/palettes.json)
     language()                            the language in use, a fresh object; .edited says whether it differs from the published one
     setPalette(id)   setFamily(id, { triad, seventh, name })   resetLanguage()        an empty value gives that field back to the set
     exportFile()     importFile(text)     one small file out and in; importFile answers { ok, ... } and takes nothing from a file it refuses
     pieceKey(score)  apply(spans, pieceKey)  choices(span)  sameNotes(spans, span)  canRemember(span, text)
     fix(pieceKey, title, span, bar, { family, text, remember })   keepAsRead(...)   unfix(pieceKey, start)   forget(input)   forgetAll()
     on(fn)           fn is told "language", "readings" or "both" after each change
     state()  kept()  isEdited()  sets()
   Switches for checking, neither of them stored:  ?studio=0  the page without this layer (app.js does not start it, and hides its section);
   ?palette=soft  a set for this visit. */
(function () {
  "use strict";
  const KEY = "colorkey.studio.v1", CK = window.ColorKey, $ = id => document.getElementById(id);
  const query = new URLSearchParams(location.search);
  const MAX_PIECES = 40, MAX_TAUGHT = 200;
  const HEX = /^#[0-9a-f]{6}$/i;
  const INPUT = /^(major|minor)\|\{(\d[+-]\d+(,\d[+-]\d+)*)?\}\|(NO_BASS_AT_START|\d[+-]\d+)$/;      // the engine's name for "these notes over this bass, in this kind of key"
  const PIECE = /^n\d{1,7}-[0-9a-f]{1,8}$/, START = /^\d{1,9}\/\d{1,6}$/, SET = /^[a-z][a-z0-9-]{0,23}$/;
  // a name or a chord is short plain text: letters, digits, spaces and the few marks music uses. Anything else is refused.
  // (Built from strings: a browser too old to know "any letter" then takes the Latin letters, where a pattern written out would stop this whole file.)
  const pattern = (more, a, z) => { try { return new RegExp("^[\\p{L}\\p{N}" + more + "]{" + a + "," + z + "}$", "u"); } catch (e) { return new RegExp("^[A-Za-z0-9\\u00C0-\\u024F" + more + "]{" + a + "," + z + "}$"); } };
  const PLAIN = pattern(" .,'’·:\\-–()♭♯°ø+/#?", 1, 24), TITLE = pattern(" .,'’·:;&\\-–()♭♯#/", 0, 80), BAR = pattern(" .\\-", 0, 12);
  const clone = o => JSON.parse(JSON.stringify(o));
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const isHex = c => typeof c === "string" && HEX.test(c), up = c => c.toUpperCase();
  const squeeze = s => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  const cleanName = s => { s = squeeze(s); return PLAIN.test(s) ? s : ""; };
  const cleanTitle = s => { s = squeeze(s).slice(0, 80); return TITLE.test(s) ? s : ""; };
  const cleanBar = s => { s = squeeze(s).slice(0, 12); return BAR.test(s) ? s : ""; };
  // a chord as it is typed: printed signs become the plain ones the engine reads, a key in front and a question mark behind are dropped
  const KEY_IN_FRONT = /^\s*[A-Ga-g](##|#|bb|b)?:\s*/;
  const plainSigns = s => String(s == null ? "" : s).replace(/𝄫/g, "bb").replace(/𝄪/g, "##").replace(/♭/g, "b").replace(/♯/g, "#").replace(/°/g, "o");
  const cleanLabel = s => cleanName(plainSigns(s).replace(KEY_IN_FRONT, "").replace(/\s*\?\s*$/, ""));

  const blank = () => ({ v: 1, palette: "reference", families: {}, pitch: null, unknown: null, taught: {}, pieces: {} });
  let S = blank(), base = null, sets = {}, order = ["reference"], dict = null, ids = [], REV = null;
  let kept = true, frozen = false;       // kept: this browser stores what is changed. frozen: another version's object is in the store and is left alone.
  let visit = false;                     // a set named in the address (?palette=) is shown and not stored, until the visitor changes something
  const listeners = [];

  // ------------------------------------------------------------------ what is kept: one object, one key
  function tidyReading(x) {        // a reading as stored or as read from a file: nothing but a family, a short text and two flags gets through
    if (!x || typeof x !== "object") return null;
    const family = ids.includes(x.family) || x.family === "unknown" ? x.family : null; if (!family) return null;
    const out = { text: cleanLabel(x.text), family, seventh: !!x.seventh, label: typeof x.label === "string" ? x.label.slice(0, 200) : null };
    if (x.was && typeof x.was === "object") out.was = { text: cleanLabel(x.was.text), family: ids.includes(x.was.family) ? x.was.family : "unknown", seventh: !!x.was.seventh };
    return out;
  }
  function tidy(o) {               // the stored object is read as carefully as a file from a stranger: other pages of the same host can write to the same store
    const out = blank();
    if (typeof o.palette === "string" && has(sets, o.palette)) out.palette = o.palette;
    for (const id of ids) {
      const e = has(o.families, id) ? o.families[id] : null, f = {}; if (!e || typeof e !== "object") continue;
      if (isHex(e.triad)) f.triad = up(e.triad); if (isHex(e.seventh)) f.seventh = up(e.seventh);
      const n = cleanName(e.name); if (n) f.name = n;
      if (Object.keys(f).length) out.families[id] = f;
    }
    if (Array.isArray(o.pitch) && o.pitch.length === 12 && o.pitch.every(isHex)) out.pitch = o.pitch.map(up);
    if (isHex(o.unknown)) out.unknown = up(o.unknown);
    if (o.taught && typeof o.taught === "object") for (const k of Object.keys(o.taught)) {
      const t = INPUT.test(k) ? tidyReading(o.taught[k]) : null; if (!t || !t.text) continue;
      const from = o.taught[k].from; t.from = { piece: cleanTitle(from && from.piece), bar: cleanBar(from && from.bar) }; t.at = +o.taught[k].at || 0;
      out.taught[k] = t;
    }
    if (o.pieces && typeof o.pieces === "object") for (const k of Object.keys(o.pieces)) {
      const p = o.pieces[k], fixes = {}; if (!PIECE.test(k) || !p || typeof p !== "object" || !p.fixes || typeof p.fixes !== "object") continue;
      for (const st of Object.keys(p.fixes)) {
        const x = p.fixes[st]; if (!START.test(st) || !x || typeof x !== "object") continue;
        const input = typeof x.input === "string" && INPUT.test(x.input) ? x.input : null, bar = cleanBar(x.bar);
        if (x.asRead) fixes[st] = { input, asRead: true, bar };
        else { const r = tidyReading(x); if (r) fixes[st] = Object.assign({ input, bar }, r); }
      }
      if (Object.keys(fixes).length) out.pieces[k] = { title: cleanTitle(p.title), at: +p.at || 0, fixes };
    }
    return out;
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY); frozen = false; kept = true;
      if (raw === null) { S = blank(); return; }
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || o.v !== 1) { S = blank(); frozen = true; kept = false; return; }       // another version's object: it is left as it is, and this visit keeps nothing
      S = tidy(o);
    } catch (e) { S = blank(); kept = false; }
  }
  const isEdited = () => S.palette !== "reference" || Object.keys(S.families).length > 0 || !!S.pitch || !!S.unknown;
  const isBlank = () => !isEdited() && !Object.keys(S.taught).length && !Object.keys(S.pieces).length;
  function save() {
    visit = false;
    if (frozen) return;
    const oldest = (o, max) => { const ks = Object.keys(o); if (ks.length > max) for (const k of ks.sort((a, b) => (o[a].at || 0) - (o[b].at || 0)).slice(0, ks.length - max)) delete o[k]; };
    oldest(S.pieces, MAX_PIECES); oldest(S.taught, MAX_TAUGHT);        // the least recently touched go first
    try { if (isBlank()) localStorage.removeItem(KEY); else localStorage.setItem(KEY, JSON.stringify(S)); kept = true; } catch (e) { kept = false; }
  }
  function changed(what) { save(); for (const fn of listeners.slice()) { try { fn(what); } catch (e) { console.error(e); } } }

  // ------------------------------------------------------------------ color arithmetic (OKLab), for the seventh shade and the three notices
  const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4), gam = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const rgbOf = hex => [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  function oklab(hex) {
    const [r, g, b] = rgbOf(hex);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function hexOfLab(L, a, b) {     // null when the color cannot be shown
    const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
    const c = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    if (c.some(v => v < -0.0005 || v > 1.0005)) return null;
    return "#" + c.map(v => Math.round(255 * gam(Math.min(1, Math.max(0, v)))).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  // The deeper shade for seventh chords, made from a color: the same hue, lightness down by 0.18 (not under 0.30), chroma times 0.66.
  // These are the medians of the nine reference pairs.
  function deeper(hex) {
    const [L, a, b] = oklab(hex), L2 = Math.max(Math.min(L, 0.30), L - 0.18);
    for (let k = 0.66; k > 0.01; k *= 0.94) { const out = hexOfLab(L2, a * k, b * k); if (out) return out; }
    return hexOfLab(L2, 0, 0) || "#444444";
  }
  const apart = (x, y) => { const p = oklab(x), q = oklab(y); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  const onWhite = hex => { const [r, g, b] = rgbOf(hex); return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05); };       // contrast against white paper

  // ------------------------------------------------------------------ the language in use = the published one + a set + the visitor's changes
  function readSets(p) {           // data/palettes.json: { sets: [{ id, name, say, families: { id: [triad, seventh] }, unknown, pitch: [twelve] }] }
    sets = {}; order = ["reference"];
    for (const s of (p && Array.isArray(p.sets) ? p.sets : [])) {
      if (!s || typeof s.id !== "string" || !SET.test(s.id) || s.id === "reference" || has(sets, s.id) || !s.families) continue;
      const fam = {}; let whole = true;
      for (const id of ids) { const c = has(s.families, id) ? s.families[id] : null; if (Array.isArray(c) && isHex(c[0]) && isHex(c[1])) fam[id] = [up(c[0]), up(c[1])]; else whole = false; }
      if (!whole) continue;
      sets[s.id] = { id: s.id, name: cleanName(s.name) || s.id, say: squeeze(s.say).slice(0, 200), families: fam, unknown: isHex(s.unknown) ? up(s.unknown) : null,
                     pitch: Array.isArray(s.pitch) && s.pitch.length === 12 && s.pitch.every(isHex) ? s.pitch.map(up) : null };
      order.push(s.id);
    }
  }
  const baseFamily = id => base.families.find(f => f.id === id);
  function setColors(id) {         // what a set gives, with nothing of the visitor's on it ("reference" is the published language)
    const s = has(sets, id) ? sets[id] : null, out = { families: {}, unknown: (s && s.unknown) || base.unknown.triad, pitch: ((s && s.pitch) || base.pitch.colors).slice() };
    for (const f of base.families) out.families[f.id] = s ? s.families[f.id].slice() : [f.triad, f.seventh];
    return out;
  }
  function language() {
    const L = clone(base), set = has(sets, S.palette) ? sets[S.palette] : null;
    for (const f of L.families) {
      const e = S.families[f.id] || {}, p = set ? set.families[f.id] : [f.triad, f.seventh];
      f.triad = e.triad || p[0];
      f.seventh = e.seventh || (e.triad ? deeper(e.triad) : p[1]);         // the seventh shade follows a color the visitor chose, until it is set by hand
      if (e.name) { f.plain.en = e.name; f.term.en = e.name; }
    }
    const un = S.unknown || (set && set.unknown); if (un) L.unknown.triad = L.unknown.seventh = un;
    const pc = S.pitch || (set && set.pitch); if (pc) L.pitch.colors = pc.slice();
    L.edited = isEdited();
    return L;
  }
  function setPalette(id) { if (id !== "reference" && !has(sets, id)) return false; if (S.palette === id) return true; S.palette = id; changed("language"); return true; }
  function setFamily(id, patch) {  // patch: { triad, seventh, name }. An empty value takes the set's own back. Answers false when a name was refused.
    if (!ids.includes(id) || !patch) return false;
    const e = Object.assign({}, S.families[id]), p = setColors(S.palette).families[id]; let ok = true;
    for (const k of ["triad", "seventh"]) if (k in patch) { if (isHex(patch[k])) e[k] = up(patch[k]); else delete e[k]; }
    if (e.triad && e.triad === up(p[0])) delete e.triad;                 // the set's own color is not a change
    if (e.seventh && !e.triad && e.seventh === up(p[1])) delete e.seventh;
    if ("name" in patch) {
      const n = cleanName(patch.name), b = baseFamily(id);
      if (!squeeze(patch.name) || n.toLowerCase() === b.plain.en.toLowerCase()) delete e.name; else if (n) e.name = n; else ok = false;
    }
    if (Object.keys(e).length) S.families[id] = e; else delete S.families[id];
    changed("language");
    return ok;
  }
  function resetLanguage() { S.palette = "reference"; S.families = {}; S.pitch = null; S.unknown = null; changed("language"); }

  // ------------------------------------------------------------------ a file the visitor can keep, pass on, and open again
  // The file is the language in use, every color written out, in the shape of data/language.json, with the readings that were taught.
  // It holds no piece, no title and no bar number.
  function exportFile(withTaught) {
    const L = language(); delete L.edited;
    const out = Object.assign({ format: "color-key-language", format_version: 1 }, L, { palette: S.palette, saved: new Date().toISOString().slice(0, 10), engine: CK.ENGINE_VERSION });
    if (isEdited()) out.name = "Color Key colors, as changed by a reader";
    if (withTaught !== false) { out.learned = {}; for (const k of Object.keys(S.taught)) { const t = S.taught[k]; out.learned[k] = { text: t.text, family: t.family, seventh: !!t.seventh, label: t.label || null }; } }
    return JSON.stringify(out, null, 1);
  }
  // A file is not trusted. A color must be #RRGGBB, a name short plain text, a family one of the nine, a reading keyed the engine's way.
  // The colors and names of the file replace the ones in use; readings in the file are added, and the ones already taught stay.
  function importFile(text) {
    if (typeof text !== "string" || text.length > 1e6) return { ok: false, why: "too-large" };
    let o; try { o = JSON.parse(text); } catch (e) { return { ok: false, why: "not-json" }; }
    if (!o || typeof o !== "object" || !Array.isArray(o.families)) return { ok: false, why: "not-colors" };
    const set = typeof o.palette === "string" && has(sets, o.palette) ? o.palette : "reference", ref = setColors(set);       // the file's colors are kept as differences from the set it names
    const rep = { ok: true, set, colors: 0, names: 0, pitch: 0, taught: 0, left: { families: 0, assign: false } }, fams = {}, seen = new Set(); let colored = 0;
    for (const f of o.families) {
      if (!f || typeof f !== "object" || !ids.includes(f.id)) { rep.left.families += 1; continue; }
      if (seen.has(f.id)) continue; seen.add(f.id);
      const e = {}, p = ref.families[f.id], t = isHex(f.triad) ? up(f.triad) : null, s = isHex(f.seventh) ? up(f.seventh) : null;
      if (t) colored += 1;
      if (t && t !== up(p[0])) e.triad = t;
      if (s && (e.triad ? s !== deeper(e.triad) : s !== up(p[1]))) e.seventh = s;       // a seventh shade that is the one made from its color stays made from it
      if (e.triad || e.seventh) rep.colors += 1;                          // counted by family: a color and its deeper shade are one
      const b = baseFamily(f.id), name = cleanName((f.plain && f.plain.en) || (f.term && f.term.en) || f.name);
      if (name && name.toLowerCase() !== b.plain.en.toLowerCase() && name.toLowerCase() !== b.term.en.toLowerCase()) { e.name = name.charAt(0).toUpperCase() + name.slice(1); rep.names += 1; }
      if (Object.keys(e).length) fams[f.id] = e;
    }
    if (!colored) return { ok: false, why: "not-colors" };               // not one of the nine families with a color: this is not a colors file, and nothing is taken
    S.palette = set; S.families = fams; S.pitch = null; S.unknown = null;
    const pc = o.pitch && Array.isArray(o.pitch.colors) && o.pitch.colors.length === 12 && o.pitch.colors.every(isHex) ? o.pitch.colors.map(up) : null;
    if (pc && pc.join() !== ref.pitch.map(up).join()) { S.pitch = pc; rep.pitch = 12; }
    const un = o.unknown && isHex(o.unknown.triad) ? up(o.unknown.triad) : null;
    if (un && un !== up(ref.unknown)) S.unknown = un;
    if (o.assign) rep.left.assign = true;                                 // which chord takes which family is not read from a file
    const learned = o.learned && typeof o.learned === "object" ? o.learned : {};
    for (const k of Object.keys(learned)) {
      const t = INPUT.test(k) && !has(S.taught, k) ? tidyReading(learned[k]) : null; if (!t || !t.text) continue;
      delete t.was; t.from = { piece: "", bar: "" }; t.at = Date.now(); S.taught[k] = t; rep.taught += 1;
    }
    changed("both");
    return rep;
  }

  // ------------------------------------------------------------------ readings: one chord in one piece, or the same notes in every piece
  function hashOf(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }
  // A piece is known by its notes (when each sounds and how high), so the same score opened again is the same piece. No file name is used.
  function pieceKey(score) { return "n" + score.sounding.length + "-" + hashOf(score.sounding.map(e => e.start.str() + "|" + e.end.str() + "|" + e.pitch.midi).sort().join(";")); }
  function put(s, c) { s.familyOverride = c.family || null; s.seventhOverride = !!c.seventh; s.textOverride = c.text || null; }
  // Lay what the visitor changed on the chords of one piece, clearing what was laid before. A change to one chord is used only while the
  // notes under it are the ones it was made on; otherwise a reading taught for exactly these notes; otherwise nothing.
  // A chord that follows a change is marked in span.studio ("fix" or "taught"), which the page counts. A chord the visitor kept out of a
  // taught reading ("not here") is the page's own reading again: it carries span.notHere and no other mark.
  function apply(spans, piece) {
    const fixes = has(S.pieces, piece) ? S.pieces[piece].fixes : {}, seen = new Set(), used = { fixes: 0, taught: 0, notHere: 0, stale: [] };
    for (const s of spans) {
      delete s.familyOverride; delete s.seventhOverride; delete s.textOverride; delete s.notHere; s.studio = null;
      if (s.status === "silent") continue;
      const st = s.start.str(), mine = has(fixes, st) ? fixes[st] : null, t = s.input && has(S.taught, s.input) ? S.taught[s.input] : null;
      if (mine && mine.input === (s.input || null)) {
        seen.add(st);
        if (!mine.asRead) { put(s, mine); s.studio = "fix"; used.fixes += 1; }
        else if (t) { s.notHere = true; used.notHere += 1; }
        continue;
      }
      if (t) { put(s, t); s.studio = "taught"; used.taught += 1; }
    }
    for (const st of Object.keys(fixes)) if (!seen.has(st)) used.stale.push(st);
    return used;
  }
  function asRead(s) {             // what the page itself read
    const mode = s.key ? s.key.mode : null;
    return { text: s.label ? CK.campaniaText(CK.labelParts(s.label, mode)) : "", family: s.label ? CK.familyOf(s.label, mode) : "unknown", seventh: !!(s.label && CK.isSeventh(s.label)) };
  }
  // the chord a visitor types, found among the chords the dictionary has counted
  function resolveLabel(text, mode) {
    if (!mode || !text || !dict) return null;
    if (!REV) {
      REV = { major: new Map(), minor: new Map() }; const tot = { major: new Map(), minor: new Map() };
      for (const k in dict.entries) { const m = k.slice(0, k.indexOf("|")); if (!tot[m]) continue; for (const [l, n] of dict.entries[k]) tot[m].set(l, (tot[m].get(l) || 0) + n); }
      for (const m of ["major", "minor"]) for (const [l, n] of tot[m]) { let tx; try { tx = CK.campaniaText(CK.labelParts(l, m)); } catch (e) { continue; } const c = REV[m].get(tx); if (!c || c[1] < n) REV[m].set(tx, [l, n]); }
    }
    const hit = REV[mode] ? REV[mode].get(cleanLabel(text)) : null; return hit ? hit[0] : null;
  }
  // How many notes of a named chord are among the notes it is named for, in the key the page found? (null: the engine has no table for this chord)
  const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
  function sharedNotes(label, input) {
    const tones = new Set();
    for (let inv = 0; inv < 4; inv++) { const pc = CK.theoreticalBassPc(label.replace(/inv=\d+/, "inv=" + inv)); if (pc !== null) tones.add(pc); }
    if (!tones.size) return null;
    const p = CK.parseInput(input), sounding = new Set(p.feats.map(f => (((SCALE[p.mode][f[0] - 1] + f[1]) % 12) + 12) % 12));
    let n = 0; for (const pc of tones) if (sounding.has(pc)) n += 1;
    return { shared: n, of: tones.size };
  }
  // The choices for one chord: what the page read, and the other counted readings of the same notes. Two that print alike are one line.
  function choices(s) {
    const mode = s.key ? s.key.mode : null, out = [], seen = new Map(), merged = [];
    const add = (label, count) => { try { out.push({ label, count, text: CK.campaniaText(CK.labelParts(label, mode)), family: CK.familyOf(label, mode), seventh: CK.isSeventh(label) }); } catch (e) { /* a label that cannot be printed is not offered */ } };
    if (s.label) add(s.label, Math.round((s.confidence || 0) * (s.support || 0)));
    for (const a of (s.alternatives || [])) add(a.label, a.count);
    for (const c of out) { const k = c.text + "|" + c.family; if (seen.has(k)) seen.get(k).count += c.count; else { seen.set(k, c); merged.push(c); } }
    return { asRead: asRead(s), counted: merged };
  }
  // May a reading be remembered for the same notes in every score? Only when the chord has notes, the name is one the dictionary has counted,
  // and the chord it names shares at least two notes with the notes sounding, in the key the page found. A reading is stored under scale
  // degrees in that key: where the key is wrong, a chord that does not fit the notes would be taught for every later score.
  function canRemember(s, text) {
    const mode = s.key ? s.key.mode : null;
    if (!s.input || !mode) return { ok: false, why: "no-notes" };
    const label = resolveLabel(text, mode); if (!label) return { ok: false, why: "unknown-label" };
    const fit = sharedNotes(label, s.input);
    return fit && fit.shared < 2 ? { ok: false, why: "does-not-fit", shared: fit.shared, of: fit.of } : { ok: true, label };
  }
  function seventhOf(text, was) {  // a chord the dictionary has not counted: its figures say whether it takes the deeper shade
    if (!text) return was.seventh;
    try { const p = CK.parseCampania(text)[0]; if (!p || p.unparsed) return was.seventh; return /^(Ger|Fr)$/.test(p.special) || /^(7|65|43|42|9|11|13)$/.test(p.figures.join("")) || /\d*b?(7|9)$/.test(p.inlineFigure || ""); } catch (e) { return was.seventh; }
  }
  const pieceOf = (piece, title) => (S.pieces[piece] = has(S.pieces, piece) ? S.pieces[piece] : { title: cleanTitle(title), at: 0, fixes: {} });
  const dropIfEmpty = piece => { if (has(S.pieces, piece) && !Object.keys(S.pieces[piece].fixes).length) delete S.pieces[piece]; };
  /* Change one chord. c: { family, text, remember }. The chord is always changed in this piece. With remember, and when canRemember allows it,
     the reading is kept for the same notes in every score instead (and then needs no entry of its own in this piece).
     Answers { where: "piece" | "everywhere", why: null | the reason remembering was refused, rec }. */
  function fix(piece, title, s, bar, c) {
    c = c || {};
    const mode = s.key ? s.key.mode : null, was = asRead(s), text = cleanLabel(c.text) || was.text, label = resolveLabel(text, mode);
    const family = ids.includes(c.family) || c.family === "unknown" ? c.family : (label ? CK.familyOf(label, mode) : was.family);
    const rec = { input: s.input || null, family, seventh: label ? CK.isSeventh(label) : seventhOf(cleanLabel(c.text), was), text, label: label || null, bar: cleanBar(bar), was };
    let where = "piece", why = null;
    if (c.remember) {
      const can = canRemember(s, text);
      if (can.ok) { S.taught[s.input] = { text, family, seventh: rec.seventh, label, was, from: { piece: cleanTitle(title), bar: rec.bar }, at: Date.now() }; where = "everywhere"; }
      else why = can.why;
    }
    const mine = pieceOf(piece, title), st = s.start.str();
    if (where === "everywhere") delete mine.fixes[st]; else mine.fixes[st] = rec;
    mine.at = Date.now(); dropIfEmpty(piece);
    changed("readings");
    return { where, why, rec };
  }
  function keepAsRead(piece, title, s, bar) {       // "not here": this chord keeps the page's own reading although a taught reading matches its notes
    const mine = pieceOf(piece, title);
    mine.fixes[s.start.str()] = { input: s.input || null, asRead: true, bar: cleanBar(bar) }; mine.at = Date.now(); changed("readings");
  }
  function unfix(piece, start) { if (!has(S.pieces, piece)) return; delete S.pieces[piece].fixes[start]; dropIfEmpty(piece); changed("readings"); }
  function forget(input) {         // a taught reading goes, and with it every "not here" that was said against it
    delete S.taught[input];
    for (const k of Object.keys(S.pieces)) { const fx = S.pieces[k].fixes; for (const st of Object.keys(fx)) if (fx[st].asRead && fx[st].input === input) delete fx[st]; dropIfEmpty(k); }
    changed("readings");
  }
  function forgetAll() { S.taught = {}; S.pieces = {}; changed("readings"); }
  const sameNotes = (spans, s) => s.input ? spans.filter(x => x !== s && x.status !== "silent" && x.input === s.input).length : 0;

  // ================================================================== the interface: three places on the page, all optional
  let P = null, used = { fixes: 0, taught: 0, notHere: 0, stale: [] }, after = null, gentle = false, drawSoon = null, wired = false;
  function h(tag, attrs, ...kids) {      // an element, built without ever reading text as markup
    const el = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) { const v = attrs[k]; if (v === false || v == null) continue; if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else el.setAttribute(k, v === true ? "" : v); }
    for (const c of kids) if (c != null && c !== false) el.append(c);
    return el;
  }
  const nice = t => (P ? P.pretty(t) : String(t)).replace(/([iv])o(?![a-z])/g, "$1°");        // a chord as the score prints it
  const num = t => h("span", { class: "num", text: nice(t) || "?" });
  const plural = (n, one, many) => n + " " + (n === 1 ? one : (many || one + "s"));
  const listOf = a => a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const famName = id => { const L = P.state.lang, f = L.families.find(x => x.id === id) || L.unknown; return f.plain.en; };
  const setName = id => id === "reference" ? "Reference" : sets[id].name;
  const calm = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function tell(msg) {             // said in the bar above the score, where a screen reader hears it; it goes after a while, as the page's own lines do
    const el = $("status"); if (!el) return;
    el.textContent = msg; el.title = msg; el.className = "status";
    setTimeout(() => { if (el.textContent === msg) { el.textContent = ""; el.title = ""; } }, 6000);
  }
  function armed(btn, again, act) {     // a step that cannot be taken back is asked for twice: the second click, within four seconds, does it
    if (btn.dataset.armed) { clearTimeout(btn._timer); delete btn.dataset.armed; btn.textContent = btn.dataset.label; act(); return; }
    btn.dataset.armed = "1"; btn.dataset.label = btn.textContent; btn.textContent = again;
    btn._timer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }, 4000);
  }
  // After each change: lay the readings again, hand the language to the page, write the lists; then, once the score is drawn, say what happened.
  // A change made in the family editor is gentle: the page takes the language without writing the editor again (a color picker that is
  // still open keeps its field), and the score is drawn a moment later, once, however many changes a browser reports while a color is chosen.
  function refresh(what) {
    if (!P) return;
    if (what !== "language" && P.state.result && P.state.piece) used = apply(P.state.result.spans, P.state.piece.key);
    let done = null; clearTimeout(drawSoon);
    if (what === "readings") done = P.redraw();
    else if (gentle) { P.setLanguage(language(), true); drawSoon = setTimeout(() => Promise.resolve(P.redraw()).catch(e => console.error(e)), 180); }
    else done = P.setLanguage(language());
    render();
    const then = after; after = null;
    Promise.resolve(done).then(() => { if (then) then(); }).catch(e => console.error(e));
  }

  // ---- the sets
  const SAY_REFERENCE = "The colors the page opens with, worked out with a music-theory teacher.";
  function drawSets() {
    const host = $("palettes"); if (!host) return;
    if (!host.children.length) {
      const wheel = ((base.wheel && base.wheel.order) || []).map(o => o.id).filter(id => ids.includes(id));
      for (const id of order) {
        const c = setColors(id), dots = h("span", { class: "dots", "aria-hidden": "true" });
        for (const fid of (wheel.length ? wheel : ids)) { const i = h("i"); i.style.background = c.families[fid][0]; dots.append(i); }
        host.append(h("button", { class: "set", type: "button", role: "radio", "data-set": id }, h("b", { text: setName(id) }), dots, h("small", { text: id === "reference" ? SAY_REFERENCE : sets[id].say })));
      }
    }
    for (const b of host.children) { const on = b.dataset.set === S.palette; b.setAttribute("aria-checked", String(on)); b.tabIndex = on ? 0 : -1; }
    const say = $("paletteSay"); if (say) say.textContent = order.length > 1 ? "A set colors the nine families and the twelve notes of Pitch Color." : "";
  }
  function pick(id, focus) {
    if (!setPalette(id)) return;
    if (focus) { const b = $("palettes").querySelector('[data-set="' + id + '"]'); if (b) b.focus(); }
  }

  // ---- the line that says which colors are in use, and the three buttons under it
  function langWords() {
    if (!isEdited()) return "Nothing changed yet.";
    const fams = Object.keys(S.families).map(id => S.families[id]), colors = fams.filter(e => e.triad || e.seventh).length, names = fams.filter(e => e.name).length;
    const mine = [colors ? plural(colors, "color") : "", names ? plural(names, "name") : "", S.pitch ? "note colors" : "", S.unknown ? "a gray" : ""].filter(Boolean);
    return "Using " + (S.palette === "reference" ? "the reference colors" : "the " + setName(S.palette) + " set") + (mine.length ? ", with " + listOf(mine) + " of your own" : "") + ".";
  }
  const langSay = msg => { const el = $("langSay"); if (el) el.textContent = msg; };
  async function download(filename, data, type) {       // the page's own way of handing over a file: a host that cannot download may take it (see save() in app.js)
    if (typeof window.ColorKeySaveHook === "function") { try { if (await window.ColorKeySaveHook({ filename, data, type })) return; } catch (e) { console.error(e); } }
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  async function saveColors() {
    await download("color-key-colors.json", exportFile(true), "application/json");
    langSay("Saved. The file holds your colors, your names and the readings you taught.");
  }
  function openedWords(rep) {
    if (!rep.ok) return "This is not a Color Key colors file. Nothing was changed.";
    const got = [rep.set !== "reference" ? "the " + setName(rep.set) + " set" : "", rep.colors ? plural(rep.colors, "color") : "", rep.names ? plural(rep.names, "name") : "", rep.pitch ? "12 note colors" : "", rep.taught ? plural(rep.taught, "reading") : ""].filter(Boolean);
    return "Opened: " + (got.length ? got.join(", ") : "the reference colors") + "."
      + (rep.left.assign ? " Its table of which chord takes which family was not used." : "")
      + (rep.left.families ? " " + plural(rep.left.families, "family", "families") + " this page does not have " + (rep.left.families === 1 ? "was" : "were") + " left out." : "");
  }
  async function openColors(file) {
    let rep = { ok: false };
    try { if (file.size <= 1e6) rep = importFile(await file.text()); } catch (e) { console.error(e); }
    langSay(openedWords(rep));
  }

  // ---- what was changed in this piece, and what was taught for every score
  function degrees(input) {        // the notes a reading is kept under: the degrees of the key's own scale, as the chord's card counts them
    try {
      const p = CK.parseInput(input), f = x => ({ "-2": "𝄫", "-1": "♭", "0": "", "1": "♯", "2": "𝄪" }[String(x[1])] || "") + x[0];
      return p.mode === "major" || p.mode === "minor" ? { mode: p.mode, notes: p.feats.map(f).join(" "), bass: p.bass ? f(p.bass) : "" } : null;
    } catch (e) { return null; }
  }
  const notesWords = input => { const g = degrees(input); return g ? "in a " + g.mode + " key, scale degrees " + g.notes + (g.bass ? " over " + g.bass : "") : "the same notes"; };       // "in a minor key, scale degrees 1 3 5 over 1"
  const sentence = s => s.charAt(0).toUpperCase() + s.slice(1);
  function row(kids, label, what, act) {      // one line of a list: what was changed, and the button that takes it back (it says aloud what it removes)
    const b = h("button", { class: "link", type: "button", "aria-label": what, text: label }); b.addEventListener("click", act);
    return h("li", {}, h("span", {}, ...kids), b);
  }
  function drawLists() {
    const here = $("hereList"), all = $("taughtList"); if (!here || !all) return;
    const piece = P.state.piece, live = !!(piece && P.state.result && $("result") && !$("result").hidden);
    const fixes = live && has(S.pieces, piece.key) ? S.pieces[piece.key].fixes : {}, at = st => { const p = st.split("/"); return +p[0] / +p[1]; };
    const held = [here, all].find(l => l.contains(document.activeElement)), heldAt = held ? [...held.children].indexOf(document.activeElement.closest("li")) : -1;       // a Remove button that is about to go
    here.textContent = ""; all.textContent = "";
    for (const st of Object.keys(fixes).sort((a, b) => at(a) - at(b))) {
      const f = fixes[st], bar = "Bar " + (f.bar || "?") + ": ", gone = () => unfix(piece.key, st);
      if (used.stale.includes(st)) here.append(row([bar + "the notes there are read differently now, so this is not used."], "Remove", "Remove the unused change in bar " + f.bar, gone));
      else if (f.asRead) { if (f.input && has(S.taught, f.input)) here.append(row([bar + "the reading you taught is not used here."], "Remove", "Remove this, so that bar " + f.bar + " follows what you taught", gone)); }
      else {
        const was = f.was || { text: "", family: "unknown" }, same = was.text === f.text, now = f.text ? [num(f.text), " (" + famName(f.family) + ")"] : ["the color of " + famName(f.family)];
        const kids = !was.text ? [bar + "no reading → ", ...now] : same && was.family === f.family ? [bar, num(f.text), " (" + famName(f.family) + "), kept as the page read it"]
          : [bar, num(was.text), same ? " (" + famName(was.family) + ")" : "", " → ", ...now];
        here.append(row(kids, "Remove", "Remove the change in bar " + f.bar, gone));
      }
    }
    for (const k of Object.keys(S.taught)) {
      const t = S.taught[k], li = row([sentence(notesWords(k)) + " → ", num(t.text), " (" + famName(t.family) + ")"], "Remove", "Remove this reading from every score", () => forget(k));
      if (t.from && t.from.piece) li.title = "Taught in " + t.from.piece + (t.from.bar ? ", bar " + t.from.bar : "");
      all.append(li);
    }
    const nHere = here.children.length, nAll = all.children.length, others = Object.keys(S.pieces).filter(k => !(live && k === piece.key)).length;
    const hide = (id, off) => { const el = $(id); if (el) el.hidden = off; };
    hide("hereTitle", !nHere); here.hidden = !nHere; hide("taughtTitle", !nAll); all.hidden = !nAll;
    const none = $("readNone");
    if (none) {
      none.textContent = others ? "Changes in " + plural(others, "other piece") + " are kept for when you open " + (others === 1 ? "it" : "them") + " again."
        : nHere || nAll ? "" : "Nothing yet. Click a Roman numeral in a score to change a reading.";
      none.hidden = !none.textContent;
    }
    const wipe = $("forgetAll"); if (wipe && !wipe.dataset.armed) wipe.hidden = !(nAll || Object.keys(S.pieces).length);
    if (held) {                    // the keyboard goes to the row that took the removed one's place, or to the nearest thing left
      const next = held.children[Math.min(heldAt, held.children.length - 1)], to = next ? next.querySelector("button") : (here.querySelector("button") || all.querySelector("button") || (wipe && !wipe.hidden ? wipe : $("langSave")));
      if (to) to.focus({ preventScroll: true });
    }
  }
  function render() {
    drawSets();
    langSay(langWords());
    const reset = $("langReset"); if (reset && !reset.dataset.armed) reset.hidden = !isEdited();
    if (P) drawLists();
    const say = $("keptSay");
    if (say) say.textContent = isBlank() || visit ? "" : kept ? "Kept in this browser only. Nothing is sent anywhere. Clearing this site's data removes it; save a file to keep it."
      : "This browser is not keeping changes. Save a file before you close the page.";
  }

  // ---- one color, one name: the editor under the family that is pinned on the wheel (app.js gives the empty place)
  const HELP = "The deeper shade for seventh chords is made from the color you pick. You can set it yourself.";
  function notice(L, id, ownT, ownS) {       // about the color being edited only, and only where it is the visitor's own
    const f = L.families.find(x => x.id === id), gray = "the gray of a chord with no reading", others = [[gray, L.unknown.triad]], out = [];
    for (const g of L.families) if (g.id !== id) { others.push([g.plain.en, g.triad]); others.push([g.plain.en, g.seventh]); }
    const near = hex => { let best = null, d0 = 0.09; for (const [n, c] of others) { const d = apart(hex, c); if (d < d0) { d0 = d; best = n; } } return best; };
    const n = (ownT && near(f.triad)) || ((ownT || ownS) && near(f.seventh)) || null;
    if (n) out.push("Close to " + n + ". The two may be hard to tell apart.");
    if (ownT && onWhite(f.triad) < 2) out.push("Light on white paper.");
    if (ownS && oklab(f.seventh)[0] >= oklab(f.triad)[0]) out.push("The seventh shade is usually the darker one.");
    return out.join(" ");
  }
  function addEditor(d) {          // d: { id, cap }
    const id = d.id, f0 = baseFamily(id); if (!f0 || !d.cap) return;
    const mine = () => S.families[id] || {}, inUse = L => L.families.find(x => x.id === id);
    const say = h("p", { class: "edit-say", role: "status" });
    const triad = h("input", { class: "swatch-in", type: "color", "data-k": "triad" }), seventh = h("input", { class: "swatch-in", type: "color", "data-k": "seventh" });
    const name = h("input", { class: "field-in", "data-k": "name", size: "12", maxlength: "24", placeholder: f0.plain.en, autocomplete: "off", spellcheck: "false", "aria-label": "Name of this family" });
    const again = h("button", { class: "link", type: "button", "data-k": "again", text: "Use the set's color again" });
    const words = (L, ownT, ownS) => { say.textContent = notice(L, id, ownT, ownS) || (ownS ? "" : HELP); };
    function show() {              // the controls show what is in use now
      const L = language(), f = inUse(L), e = mine();
      triad.value = f.triad.toLowerCase(); seventh.value = f.seventh.toLowerCase(); name.value = f.plain.en;
      triad.setAttribute("aria-label", "Color of " + f.plain.en); seventh.setAttribute("aria-label", "Color of " + f.plain.en + " seventh chords");
      again.hidden = !(e.triad || e.seventh);
      words(L, !!e.triad, !!e.seventh);
    }
    // Stored: the wheel, the rows, the legend and the accents follow at once, the score a moment later. The editor itself stays as it is,
    // so the keyboard is where it was, and a color picker that reports every step of a choice as a finished one keeps its field.
    let trying = false;            // a color is on show that is not stored: a choice in progress
    const store = patch => { trying = false; gentle = true; try { setFamily(id, patch); } finally { gentle = false; } show(); };
    // while a color is being dragged nothing is stored and the score waits
    const drag = (k, hex) => {
      const L = language(), g = inUse(L), e = mine();
      if (k === "triad") { g.triad = up(hex); if (!e.seventh) { g.seventh = deeper(hex); seventh.value = g.seventh.toLowerCase(); } } else g.seventh = up(hex);
      L.edited = true; words(L, k === "triad" || !!e.triad, k === "seventh" || !!e.seventh);
      trying = true; P.setLanguage(L, true);
    };
    for (const [k, el] of [["triad", triad], ["seventh", seventh]]) {
      el.addEventListener("input", () => { if (isHex(el.value)) drag(k, el.value); });
      el.addEventListener("change", () => { if (isHex(el.value)) store({ [k]: el.value }); });
      el.addEventListener("blur", () => { if (trying) { trying = false; P.setLanguage(language(), true); show(); } });       // a choice that was given up: back to what is stored
    }
    const rename = () => {
      const now = inUse(language()).plain.en; if (squeeze(name.value) === now) return;
      if (squeeze(name.value) && !cleanName(name.value)) { name.value = now; say.textContent = "A name is up to 24 letters, digits and spaces."; return; }
      store({ name: name.value });
    };
    name.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); rename(); } });
    name.addEventListener("change", rename);
    again.addEventListener("click", () => { const held = document.activeElement === again; store({ triad: "", seventh: "" }); if (held) triad.focus({ preventScroll: true }); });       // the link goes with what it undid
    d.cap.append(h("div", { class: "edit" }, h("label", {}, triad, "Color"), h("label", {}, seventh, "Seventh chords"), h("label", {}, "Name ", name), again, say));
    show();
  }

  // ---- "Not what you hear? Choose another reading": the part of a chord's card that changes it (app.js gives the card before it is placed)
  function addRows(d) {            // d: { i, span, box, bar, piece }
    const s = d.span, box = d.box, piece = d.piece; if (!s || !box || !piece || s.status === "silent") return;
    const L = P.state.lang, mode = s.key ? s.key.mode : null, ch = choices(s), was = ch.asRead, st = s.start.str();
    const cur = { text: s.textOverride || was.text, family: s.family || was.family };
    const inKey = s.key ? " in " + P.keyName(s.key.name) : "";
    // what follows a change: the card closes because the score is drawn again, so the bar above the score says it, and the keyboard returns to the chord
    const go = (run, words) => {
      const inside = box.contains(document.activeElement);
      after = () => { tell(words()); const el = inside ? document.querySelector('#score text[data-i="' + d.i + '"]') : null; if (el) el.focus({ preventScroll: true }); };
      run(); after = null;
    };
    const link = (label, act) => { const b = h("button", { class: "link", type: "button", text: label }); b.addEventListener("click", act); return b; };
    const reads = () => "Bar " + d.bar + (was.text ? " reads " + nice(was.text) + " again." : " has no reading again."), keeps = () => "Bar " + d.bar + " keeps the page's reading.";
    // 1. what the visitor did to this chord before, said first
    const wasWords = was.text ? ["The page read it as ", num(was.text), " (" + famName(was.family) + ")."] : ["The page gave it no reading."];
    let mine = null;
    if (s.studio === "fix") mine = h("p", { class: "mine" }, "You changed this chord. ", ...wasWords, " ", link("Back to the page's reading", () => go(() => unfix(piece.key, st), reads)));
    else if (s.studio === "taught") mine = h("p", { class: "mine" }, "Read this way because you taught it. ", ...wasWords, " ",
      link("Not here", () => go(() => keepAsRead(piece.key, piece.title, s, d.bar), keeps)), " · ",
      link("Forget it everywhere", () => go(() => forget(s.input), () => "That reading is forgotten.")));
    else if (s.notHere) mine = h("p", { class: "mine" }, "The reading you taught for these notes is not used here. ", link("Use it here", () => go(() => unfix(piece.key, st), () => "Bar " + d.bar + " follows what you taught.")));
    else if (s.label && s.cueDegree) mine = h("p", { class: "mine" }, "The page is unsure of this chord. ",
      link("It is right", () => go(() => fix(piece.key, piece.title, s, d.bar, { text: was.text, family: was.family }), () => "Bar " + d.bar + " keeps " + nice(was.text) + ", without the question mark.")));
    if (mine) { const where = box.querySelector(".where"); if (where) where.after(mine); else box.append(mine); }

    // 2. the form
    const sel = { text: cur.text, family: cur.family }, chips = [];
    const role = h("select", { class: "field-in", id: "whyRole" });
    const fams = ((L.wheel && L.wheel.order) || []).map(o => L.families.find(f => f.id === o.id)).filter(Boolean);
    for (const f of (fams.length ? fams : L.families)) role.append(h("option", { value: f.id, text: f.plain.en }));
    if (cur.family === "unknown" || !ids.includes(cur.family)) role.prepend(h("option", { value: "unknown", text: L.unknown.plain.en }));
    role.value = ids.includes(cur.family) ? cur.family : "unknown";
    const text = h("input", { class: "field-in", id: "whyText", placeholder: "V7, ii65, V7/V, N6", size: "16", maxlength: "24", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-describedby": "whySay" });
    const change = h("button", { class: "btn", type: "button", text: "Change" }), say = h("p", { class: "change-say", id: "whySay", role: "status" });
    const keep = s.input && mode ? h("input", { type: "checkbox", id: "whyKeep", "aria-describedby": "whyKeepSay" }) : null, keepSay = keep ? h("p", { class: "check-say", id: "whyKeepSay", role: "status" }) : null;
    const WRITE = "Write it as it would stand under the staff.";
    const more = keep ? sameNotes(P.state.result.spans, s) : 0;
    const dg = keep ? degrees(s.input) : null;
    const same = "The same notes means the same scale degrees over the same bass" + (dg ? " (here " + dg.notes + (dg.bass ? " over " + dg.bass : "") + ", in a " + dg.mode + " key)" : "") + ". "
      + (more ? plural(more, "more chord") + " in this piece " + (more === 1 ? "has" : "have") + " them." : "No other chord in this piece has them.");
    const count = n => ["no note", "one note", "two notes", "three notes"][n] || n + " notes";
    function words() {             // the two quiet lines follow what is chosen
      const typed = squeeze(text.value), clean = cleanLabel(typed);
      let line = WRITE;
      if (typed && !clean) line = "A chord name is up to 24 letters, digits and the signs music uses.";
      else if (KEY_IN_FRONT.test(plainSigns(typed))) line = "The key cannot be changed here yet. The chord is read" + (inKey || " in the key the page found") + ".";
      else if (clean && CK.parseCampania(clean).some(l => l.unparsed)) line = "The page does not know this way of writing a chord. It is printed as written.";
      say.textContent = line;
      if (!keep) return;
      const can = keep.checked ? canRemember(s, sel.text) : { ok: true };
      if (!can.ok && can.why === "does-not-fit") { keepSay.textContent = ""; keepSay.append("It will not be remembered: ", num(sel.text), " shares " + count(can.shared) + " with these notes" + inKey + ". If the key is wrong at this spot, the reading would be wrong in every score."); }
      else keepSay.textContent = can.ok ? same : !sel.text ? "It can be remembered only under a chord name. Write the chord first."
        : "It will not be remembered: the page has never counted a chord with this name, so it is kept for this chord only.";
    }
    function show() { for (const c of chips) c.el.setAttribute("aria-pressed", String(c.text === sel.text && c.family === sel.family)); role.value = sel.family; words(); }
    // While the fold is closed its controls are taken out altogether (not only out of sight), so that Tab, which the card keeps inside itself,
    // never counts them: a browser still lays out what a closed fold holds.
    const rows = h("div", { hidden: true });
    if (ch.counted.length) {
      const line = h("div", { class: "change-row", role: "group", "aria-labelledby": "whyAsL" }, h("label", { id: "whyAsL", text: "Read it as" }));
      for (const c of ch.counted.slice(0, 6)) {
        const b = h("button", { class: "chip", type: "button", "aria-pressed": "false" }, num(c.text), " · " + c.count.toLocaleString("en-US"));
        b.addEventListener("click", () => { sel.text = c.text; sel.family = c.family; text.value = ""; show(); });
        chips.push({ el: b, text: c.text, family: c.family }); line.append(b);
      }
      rows.append(line);
    }
    role.addEventListener("change", () => { sel.family = role.value; show(); });
    text.addEventListener("input", () => {        // a chord the dictionary has counted brings its own role
      const clean = cleanLabel(text.value), label = resolveLabel(clean, mode);
      sel.text = clean || cur.text; if (label) sel.family = CK.familyOf(label, mode); else if (!clean) sel.family = cur.family;
      show();
    });
    text.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); change.click(); } });
    if (keep) keep.addEventListener("change", words);
    change.addEventListener("click", () => {
      const typed = squeeze(text.value), remember = !!(keep && keep.checked);
      if (typed && !cleanLabel(typed)) { words(); text.focus(); return; }
      if (!remember && sel.text === cur.text && sel.family === cur.family) { say.textContent = "That is how it reads now. Choose another reading or role, or write the chord."; return; }
      if (!remember && sel.text === was.text && sel.family === was.family) {       // the page's own reading, chosen on a chord that was changed: the change is taken back
        if (s.studio === "fix") { go(() => unfix(piece.key, st), reads); return; }
        if (s.studio === "taught") { go(() => keepAsRead(piece.key, piece.title, s, d.bar), keeps); return; }
      }
      let res = null;
      go(() => { res = fix(piece.key, piece.title, s, d.bar, { text: sel.text, family: sel.family, remember }); },
         () => "Bar " + d.bar + (!res.rec.text ? " now has the color of " + famName(res.rec.family) : " now reads " + nice(res.rec.text) + (res.rec.text === was.text && res.rec.family !== was.family ? " as " + famName(res.rec.family) : "")) + "."
               + (!remember ? "" : res.where === "everywhere" ? " Changed here and remembered." : " Changed here, not remembered."));
    });
    rows.append(h("div", { class: "change-row" }, h("label", { for: "whyRole", text: "Role" }), role),
                h("div", { class: "change-row" }, h("label", { for: "whyText", text: "Or write the chord" }), text, change), say);
    if (keep) rows.append(h("label", { class: "check" }, keep, h("span", { text: "Remember this for the same notes in every score." })), keepSay);
    const fold = h("details", { class: "change" }, h("summary", { text: "Not what you hear? Choose another reading." }), rows);
    fold.addEventListener("toggle", () => { rows.hidden = !fold.open; if (fold.open) fold.scrollIntoView({ block: "nearest", behavior: calm() ? "auto" : "smooth" }); });
    box.append(fold);
    show();
  }

  // ---- once: listeners on the section's own controls, and on what app.js announces
  function wire() {
    if (wired) return; wired = true;
    const host = $("palettes");
    if (host) {
      host.addEventListener("click", ev => { const b = ev.target.closest ? ev.target.closest(".set") : null; if (b) pick(b.dataset.set); });
      host.addEventListener("keydown", ev => {       // a radio group: the arrow keys move and choose
        const b = ev.target.closest ? ev.target.closest(".set") : null, at = b ? order.indexOf(b.dataset.set) : -1; if (at < 0) return;
        const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: order.length - 1 }[ev.key];
        if (to === undefined || ev.altKey || ev.ctrlKey || ev.metaKey) return;
        ev.preventDefault(); pick(order[(to + order.length) % order.length], true);
      });
    }
    const on = (id, type, fn) => { const el = $(id); if (el) el.addEventListener(type, fn); return el; };
    const tip = (el, words) => { if (el) el.title = words; };
    tip(on("langSave", "click", saveColors), "One small file with your colors, your names and the readings you taught. Open it on another device, or give it to a student.");
    tip(on("langOpen", "click", () => { const f = $("langFile"); if (f) f.click(); }), "Takes the colors and names from a file saved here. What you taught stays; readings in the file are added.");
    on("langFile", "change", ev => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (f) openColors(f); });
    tip(on("langReset", "click", ev => armed(ev.currentTarget, "Click again to go back", () => {
      const n = Object.keys(S.taught).length; resetLanguage();
      langSay("Back to the reference colors and names." + (n ? " What you taught is kept." : "")); const s = $("langSave"); if (s) s.focus();
    })), "Returns to the reference colors and names. What you taught is kept.");
    on("forgetAll", "click", ev => armed(ev.currentTarget, "Click again to forget", () => {
      after = () => tell("Every reading is the page's own again."); forgetAll(); after = null;
      const s = $("langSave"); if (s) s.focus({ preventScroll: true });       // the button has gone with what it forgot
    }));
    P.on("analysis", d => { used = apply(d.spans, d.piece.key); drawLists(); });
    P.on("why", addRows);
    P.on("family", addEditor);
    listeners.push(refresh);
    window.addEventListener("storage", ev => { if (ev.key !== KEY && ev.key !== null) return; visit = false; load(); refresh("both"); });       // another tab of this page changed something: the last change wins
  }

  function init(o) {
    base = clone(o.base); dict = o.dict || null; REV = null; ids = base.families.map(f => f.id); readSets(o.palettes); load();
    const q = query.get("palette"); visit = !!q && (q === "reference" || has(sets, q)) && q !== S.palette; if (visit) S.palette = q;       // for a picture: shown, and not stored unless something is changed
    P = window.ColorKeyPage && typeof window.ColorKeyPage.on === "function" ? window.ColorKeyPage : null;       // without the page (a check of this file alone) there is nothing to draw
    if (P) { wire(); render(); }
  }

  window.CKStudio = {
    init, on(fn) { listeners.push(fn); }, state: () => clone(S), kept: () => kept, isEdited, sets: () => order.map(id => ({ id, name: setName(id) })),
    language, setPalette, setFamily, resetLanguage, exportFile, importFile,
    pieceKey, apply, choices, sameNotes, canRemember, fix, keepAsRead, unfix, forget, forgetAll, resolveLabel, sharedNotes, asRead, deeper
  };
})();
