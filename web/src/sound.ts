/**
 * Tiny synthesized sound effects (Web Audio, no audio files):
 * a sonar ping on accept, a soft thud on a miss, and little bubble pops.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freqStart: number, freqEnd: number, duration: number, volume: number, type: OscillatorType, delay = 0) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t);
  osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

export const sounds = {
  /** Sonar ping with a quieter echo. Rarer tiers ping a little higher. */
  ping(tierPoints = 10) {
    const f = 900 + tierPoints * 4;
    tone(f, f * 0.92, 0.9, 0.22, "sine");
    tone(f, f * 0.92, 0.9, 0.07, "sine", 0.35);
  },
  thud() {
    tone(140, 45, 0.28, 0.35, "sine");
  },
  bubble() {
    tone(320 + Math.random() * 200, 1100 + Math.random() * 300, 0.09, 0.08, "sine");
  },
  bubbles(count = 4) {
    for (let i = 0; i < count; i++) setTimeout(() => sounds.bubble(), i * 70 + Math.random() * 40);
  },
};
