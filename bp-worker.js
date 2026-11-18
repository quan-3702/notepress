// NotePress – listens to the music and writes down the notes: Basic Pitch by Spotify (Apache-2.0) with TensorFlow.js
// (Apache-2.0). Runs on this computer. Long songs are done in 60-second pieces that overlap, so memory stays small.
self.window = self; // TensorFlow.js looks for "window" in a few places
importScripts('bp-bundle.js');
const { tf, BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = self.BP;
let model = null, backend = '';
async function load() {
  if (model) return;
  for (const b of ['webgl', 'cpu']) { try { if (await tf.setBackend(b)) { await tf.ready(); backend = b; break; } } catch (_) {} }
  model = await tf.loadGraphModel(new URL('model.json', self.location.href).href);
}
const SR = 22050, PIECE = 60, OVER = 2;
self.onmessage = async (e) => {
  const m = e.data; if (m.type !== 'run') return;
  try {
    await load();
    postMessage({ type: 'progress', p: 0, backend });
    const x = m.audio, n = x.length, piece = PIECE * SR, over = OVER * SR, out = [];
    const pieces = Math.max(1, Math.ceil(n / piece));
    for (let k = 0; k < pieces; k++) {
      const a = k * piece, s0 = Math.max(0, a - over), b = Math.min(n, a + piece), s1 = Math.min(n, b + over);
      const fr = [], on = [], co = [];
      tf.engine().startScope();
      try {
        const bp = new BasicPitch(Promise.resolve(model));
        await bp.evaluateModel(x.subarray(s0, s1), (f, o, c) => { fr.push(...f); on.push(...o); co.push(...c); }, (p) => postMessage({ type: 'progress', p: (k + p) / pieces, backend }));
      } finally { tf.engine().endScope(); }
      const ev = noteFramesToTime(addPitchBendsToNoteEvents(co, outputToNotesPoly(fr, on, m.onset, m.frame, m.minFrames, true, null, null, true, 11)));
      const lo = (a - s0) / SR - (k ? 0 : 1), hi = (b - s0) / SR;
      for (const n2 of ev) if (n2.startTimeSeconds >= lo && (n2.startTimeSeconds < hi || k === pieces - 1)) out.push({ pitchMidi: n2.pitchMidi, startTimeSeconds: +(n2.startTimeSeconds + s0 / SR).toFixed(4), durationSeconds: +n2.durationSeconds.toFixed(4), amplitude: +n2.amplitude.toFixed(3) });
    }
    postMessage({ type: 'done', events: out, backend });
  } catch (err) { postMessage({ type: 'error', message: String((err && err.message) || err) }); }
};
