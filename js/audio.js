// Beeps generated with the Web Audio API (no sound files needed).
// Browsers only allow sound after a user tap, so unlockAudio() must be called from a tap handler.

let ctx = null;

export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) ctx = new AC();
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // A silent buffer fully unlocks output on iOS.
  const buffer = ctx.createBuffer(1, 1, 22050);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
}

export function isAudioUnlocked() {
  return ctx !== null;
}

function beep(freq, duration, volume, delay = 0) {
  if (!ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

export const sounds = {
  countdown: () => beep(880, 0.12, 0.6),
  work: () => beep(1320, 0.5, 0.7),
  rest: () => beep(660, 0.5, 0.6),
  finish: () => {
    beep(880, 0.15, 0.6, 0);
    beep(1100, 0.15, 0.6, 0.18);
    beep(1320, 0.5, 0.7, 0.36);
  },
};

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
});
