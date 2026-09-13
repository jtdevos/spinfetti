// Sound effects, synthesized on the fly via the Web Audio API — no audio
// asset files to source, license, or host. Decoupled from the wheel and
// celebration modules via events ("wheel:tick", "wheel:winner",
// "celebration:burst"), matching the pattern the rest of the app uses to
// keep its pieces independent.

let ctx = null;

function getContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Browsers won't let audio play until there's been a user gesture somewhere
// on the page; grab the first one to unlock the context well before any
// sound is actually needed.
function unlock() {
  getContext();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
}
window.addEventListener("pointerdown", unlock, { once: true });
window.addEventListener("keydown", unlock, { once: true });

// A short noise burst, shaped by a gain envelope and an optional swept
// lowpass filter — the building block for both the tick and the firework
// pop. Cheaper and more percussive-sounding than an oscillator for this
// kind of transient.
function playNoiseBurst({ duration, peakGain, filterStart, filterEnd, filterType = "lowpass" }) {
  const ctx = getContext();
  const now = ctx.currentTime;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(filterStart, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 1), now + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration);
}

// The wheel's clicker flapper — one sharp tick per slice boundary crossed.
function playTick() {
  playNoiseBurst({
    duration: 0.035,
    peakGain: 0.18,
    filterType: "bandpass",
    filterStart: 2400 + Math.random() * 600,
    filterEnd: 1200,
  });
}

// A soft, distant-sounding "thump" per confetti burst — deliberately muted
// per the brief, so a flurry of overlapping bursts doesn't turn into noise.
function playFireworkPop() {
  playNoiseBurst({
    duration: 0.32 + Math.random() * 0.1,
    peakGain: 0.1,
    filterType: "lowpass",
    filterStart: 900 + Math.random() * 300,
    filterEnd: 120,
  });
}

// A tiny brass-ish fanfare (sawtooth through a lowpass, not a real trumpet
// sample) for the win reveal.
function playFanfare() {
  const ctx = getContext();
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6

  notes.forEach((freq, i) => {
    const start = now + i * 0.1;
    const noteDuration = 0.5;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + noteDuration);

    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteDuration + 0.05);
  });
}

window.addEventListener("wheel:tick", playTick);
window.addEventListener("wheel:winner", playFanfare);
window.addEventListener("celebration:burst", playFireworkPop);
