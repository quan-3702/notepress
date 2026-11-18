// NotePress – notes from the AI → clean notes, tempo, key, MIDI and MusicXML (sheet music). No DOM – tested with node.
const NPC = (() => {
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (p, flat) => (flat ? NAMES_FLAT : NAMES_SHARP)[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
const INSTRUMENTS = {
  piano: { name: 'Piano / keyboard', min: 21, max: 108, melody: false, program: 0 },
  guitar: { name: 'Guitar', min: 40, max: 88, melody: false, program: 24 },
  voice: { name: 'Singing / melody', min: 43, max: 84, melody: true, program: 52 },
  bass: { name: 'Bass', min: 28, max: 60, melody: true, program: 33 },
  other: { name: 'Other instrument', min: 21, max: 108, melody: false, program: 0 },
};
// AI note events → { p (MIDI pitch), s (start, s), d (length, s), v (0..1) }
function clean(events, o) {
  o = o || {};
  let ns = events.map((e) => ({ p: e.pitchMidi, s: e.startTimeSeconds, d: e.durationSeconds, v: Math.max(0.05, Math.min(1, e.amplitude || 0.6)) }))
    .filter((n) => n.p >= (o.min || 0) && n.p <= (o.max || 127) && n.d >= (o.minLen || 0.06))
    .sort((a, b) => a.s - b.s || b.p - a.p);
  // overtones: a quiet note an octave, an octave + fifth or two octaves above a louder note that starts with it
  const OVER = { 12: 1.6, 19: 2.2, 24: 1.8, 28: 1.8 }; // interval → how much louder the low note must be
  ns = ns.filter((n) => !ns.some((m) => m !== n && OVER[n.p - m.p] && Math.abs(m.s - n.s) < 0.08 && m.v >= n.v * OVER[n.p - m.p] && m.d >= n.d * 0.6));
  // the same note cut into pieces (a gap of under 40 ms) becomes one note again
  const byP = new Map(); for (const n of ns) { if (!byP.has(n.p)) byP.set(n.p, []); byP.get(n.p).push(n); }
  const merged = [];
  for (const list of byP.values()) { list.sort((a, b) => a.s - b.s); let c = null; for (const n of list) { if (c && n.s - (c.s + c.d) < 0.04 && n.v <= c.v * 1.3) { c.d = Math.max(c.d, n.s + n.d - c.s); continue; } c = { ...n }; merged.push(c); } }
  ns = merged.sort((a, b) => a.s - b.s || b.p - a.p);
  if (o.melody) { // one note at a time: the highest one wins, the one under it is cut
    const out = [];
    for (const n of ns) {
      const last = out[out.length - 1];
      if (last && n.s < last.s + last.d - 0.03) {
        if (n.p > last.p && n.s - last.s < 0.05) { out[out.length - 1] = n; continue; }
        if (n.p > last.p) last.d = Math.max(0.05, n.s - last.s); else continue;
      }
      out.push({ ...n });
    }
    ns = out.filter((n) => n.d >= (o.minLen || 0.06));
  }
  return ns;
}
// tempo from the note starts (louder notes count more), 60–180 BPM, and where the first beat is
function tempo(notes, dur) {
  const fps = 100, n = Math.ceil(((dur || (notes.length ? notes[notes.length - 1].s + 1 : 1)) + 1) * fps), env = new Float32Array(n);
  for (const x of notes) { const i = Math.round(x.s * fps); if (i < n) env[i] += 0.3 + x.v; }
  // smooth a little so near misses still line up
  const sm = new Float32Array(n); for (let i = 0; i < n; i++) sm[i] = env[i] + 0.5 * ((env[i - 1] || 0) + (env[i + 1] || 0));
  let best = 0, bpm = 120;
  for (let b = 60; b <= 180; b += 0.5) {
    const lag = (60 / b) * fps; let s = 0;
    for (const k of [1, 2]) { const L = Math.round(lag * k); for (let i = L; i < n; i++) s += sm[i] * sm[i - L] * (k === 1 ? 1 : 0.5); }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(b / 110) / 0.7, 2));
    if (s * prior > best) { best = s * prior; bpm = b; }
  }
  const P = (60 / bpm) * fps; let bp = 0, bs = -1;
  for (let ph = 0; ph < P; ph += 1) { let s = 0; for (let t = ph; t < n; t += P) s += sm[Math.round(t)] || 0; if (s > bs) { bs = s; bp = ph; } }
  return { bpm: Math.round(bpm), offset: +(bp / fps).toFixed(3) };
}
// key from how long each pitch class sounds (Krumhansl–Schmuckler)
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let s = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; s += x * y; sa += x * x; sb += y * y; } return sa && sb ? s / Math.sqrt(sa * sb) : 0; };
// fifths for each major key root (C=0 …); minor keys use their relative major
const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
function key(notes) {
  const h = new Array(12).fill(0); for (const n of notes) h[n.p % 12] += n.d * (0.5 + n.v);
  let best = -2, k = { root: 0, mode: 'major' };
  for (let r = 0; r < 12; r++) for (const [prof, mode] of [[KS_MAJ, 'major'], [KS_MIN, 'minor']]) { const c = corr(h, prof.map((_, i) => prof[(i - r + 12) % 12])); if (c > best) { best = c; k = { root: r, mode }; } }
  const majRoot = k.mode === 'major' ? k.root : (k.root + 3) % 12;
  return { ...k, fifths: FIFTHS[majRoot], name: (FIFTHS[majRoot] < 0 ? NAMES_FLAT : NAMES_SHARP)[k.root] + (k.mode === 'minor' ? ' minor' : ' major') };
}

// ---------- MIDI (format 1: tempo track + one instrument track) ----------
function vlq(n) { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
function toMidi(notes, o) {
  o = o || {}; const bpm = o.bpm || 120, PPQ = 480, tps = (PPQ * bpm) / 60; // ticks per second
  const str = (s) => Array.from(s).map((c) => c.charCodeAt(0) & 255);
  const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const track = (ev) => { const d = []; let t = 0; ev.sort((a, b) => a.t - b.t || a.o - b.o); for (const e of ev) { d.push(...vlq(Math.max(0, e.t - t)), ...e.b); t = e.t; } d.push(0, 0xff, 0x2f, 0); return [...str('MTrk'), ...u32(d.length), ...d]; };
  const us = Math.round(60e6 / bpm), [bn, bt] = [o.beats || 4, o.beatType || 4];
  const t0 = [{ t: 0, o: 0, b: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }, { t: 0, o: 0, b: [0xff, 0x58, 4, bn, Math.log2(bt), 24, 8] }];
  if (o.key) t0.push({ t: 0, o: 0, b: [0xff, 0x59, 2, o.key.fifths & 255, o.key.mode === 'minor' ? 1 : 0] });
  if (o.title) { const tt = str(o.title.slice(0, 100)); t0.push({ t: 0, o: 0, b: [0xff, 0x03, tt.length, ...tt] }); }
  const ev = [{ t: 0, o: 0, b: [0xc0, (o.program || 0) & 127] }];
  for (const n of notes) { const a = Math.round(n.s * tps), b = Math.max(a + 1, Math.round((n.s + n.d) * tps)), v = Math.max(1, Math.min(127, Math.round(n.v * 127))); ev.push({ t: a, o: 2, b: [0x90, n.p, v] }, { t: b, o: 1, b: [0x80, n.p, 0] }); }
  const hdr = [...str('MThd'), 0, 0, 0, 6, 0, 1, 0, 2, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...hdr, ...track(t0), ...track(ev)]);
}

// ---------- sheet music (MusicXML 3.1, piano: treble + bass staff) ----------
const TYPES = { 16: ['whole', 0], 12: ['half', 1], 8: ['half', 0], 6: ['quarter', 1], 4: ['quarter', 0], 3: ['eighth', 1], 2: ['eighth', 0], 1: ['16th', 0] };
const PARTS = [16, 12, 8, 6, 4, 3, 2, 1];
function split(d) { const out = []; while (d > 0) { const p = PARTS.find((x) => x <= d); out.push(p); d -= p; } return out; }
// notes (seconds) → events per staff in 16th notes
function quantize(notes, o) {
  const sp = 60 / o.bpm / 4, off = o.offset || 0; // seconds per 16th
  const q = notes.map((n) => { const a = Math.max(0, Math.round((n.s - off) / sp)), b = Math.max(a + 1, Math.round((n.s + n.d - off) / sp)); return { p: n.p, a, b }; });
  // the same pitch starting at the same 16th once only
  const seen = new Set(); return q.filter((n) => { const k = n.p + ':' + n.a; if (seen.has(k)) return false; seen.add(k); return true; });
}
function staffEvents(q, measureLen, total) {
  const byStart = new Map(); for (const n of q) { if (!byStart.has(n.a)) byStart.set(n.a, []); byStart.get(n.a).push(n); }
  const starts = Array.from(byStart.keys()).sort((a, b) => a - b), ev = [];
  let t = 0;
  for (let i = 0; i < starts.length; i++) {
    const a = starts[i], grp = byStart.get(a), next = i + 1 < starts.length ? starts[i + 1] : Infinity;
    if (a > t) ev.push({ rest: true, a: t, d: a - t });
    const end = Math.min(next, Math.max(...grp.map((n) => n.b)));
    ev.push({ a, d: Math.max(1, end - a), ps: grp.map((n) => n.p).sort((x, y) => x - y) });
    t = a + Math.max(1, end - a);
  }
  if (t < total) ev.push({ rest: true, a: t, d: total - t });
  // cut at bar lines (tied notes, separate rests)
  const out = [];
  for (const e of ev) {
    let a = e.a, d = e.d;
    while (d > 0) { const room = measureLen - (a % measureLen), part = Math.min(d, room); out.push({ ...e, a, d: part, tieStart: !e.rest && part < d, tieStop: !e.rest && a > e.a }); a += part; d -= part; }
  }
  return out;
}
const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function pitchXml(p, flat) { const name = (flat ? NAMES_FLAT : NAMES_SHARP)[p % 12], step = name[0], alter = name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0, oct = Math.floor(p / 12) - 1; return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ''}<octave>${oct}</octave></pitch>`; }
function toMusicXML(notes, o) {
  o = o || {};
  const beats = o.beats || 4, beatType = o.beatType || 4, measureLen = beats * (16 / beatType), k = o.key || { fifths: 0, mode: 'major' }, flat = k.fifths < 0;
  const q = quantize(notes, o), lastEnd = q.reduce((m, n) => Math.max(m, n.b), 0), measures = Math.max(1, Math.ceil(lastEnd / measureLen)), total = measures * measureLen;
  const split2 = o.staves === 1 ? null : o.splitAt || 60;
  const staves = split2 == null ? [q] : [q.filter((n) => n.p >= split2), q.filter((n) => n.p < split2)];
  const evs = staves.map((s) => staffEvents(s, measureLen, total));
  const clefs = split2 == null ? [(q.reduce((s, n) => s + n.p, 0) / Math.max(1, q.length)) < 57 ? ['F', 4] : ['G', 2]] : [['G', 2], ['F', 4]];
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="3.1"><work><work-title>${xesc(o.title || 'Transcription')}</work-title></work><identification><encoding><software>NotePress</software></encoding></identification><part-list><score-part id="P1"><part-name>${xesc(o.part || 'Piano')}</part-name></score-part></part-list><part id="P1">`;
  for (let m = 0; m < measures; m++) {
    xml += `<measure number="${m + 1}">`;
    if (m === 0) {
      xml += `<attributes><divisions>4</divisions><key><fifths>${k.fifths}</fifths><mode>${k.mode}</mode></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>${evs.length > 1 ? '<staves>2</staves>' : ''}${clefs.map((c, i) => `<clef${evs.length > 1 ? ` number="${i + 1}"` : ''}><sign>${c[0]}</sign><line>${c[1]}</line></clef>`).join('')}</attributes>`;
      xml += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${o.bpm}</per-minute></metronome></direction-type><sound tempo="${o.bpm}"/></direction>`;
    }
    evs.forEach((ev, si) => {
      if (si > 0) xml += `<backup><duration>${measureLen}</duration></backup>`;
      const voice = si === 0 ? 1 : 5, staff = evs.length > 1 ? `<staff>${si + 1}</staff>` : '';
      for (const e of ev.filter((x) => Math.floor(x.a / measureLen) === m)) {
        const parts = split(e.d);
        parts.forEach((d, pi) => {
          const [type, dot] = TYPES[d], first = pi === 0, last = pi === parts.length - 1;
          if (e.rest) { xml += `<note><rest/><duration>${d}</duration><voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}${staff}</note>`; return; }
          const tStart = !last || e.tieStart, tStop = !first || e.tieStop;
          e.ps.forEach((p, ci) => {
            xml += `<note>${ci ? '<chord/>' : ''}${pitchXml(p, flat)}<duration>${d}</duration>${tStop ? '<tie type="stop"/>' : ''}${tStart ? '<tie type="start"/>' : ''}<voice>${voice}</voice><type>${type}</type>${dot ? '<dot/>' : ''}${staff}${tStart || tStop ? `<notations>${tStop ? '<tied type="stop"/>' : ''}${tStart ? '<tied type="start"/>' : ''}</notations>` : ''}</note>`;
          });
        });
      }
    });
    if (m === measures - 1) xml += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    xml += '</measure>';
  }
  return xml + '</part></score-partwise>\n';
}
const clock = (s) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), x = Math.floor(s % 60); return m + ':' + String(x).padStart(2, '0'); };
const safeName = (s) => String(s || 'Song').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Song';
return { INSTRUMENTS, noteName, clean, tempo, key, toMidi, quantize, staffEvents, toMusicXML, split, clock, safeName };
})();
if (typeof module !== 'undefined') module.exports = NPC;
