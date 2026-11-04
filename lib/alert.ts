// A front-desk attention chime, three rising two-tone pulses, made in the
// browser so there is no audio file to host. Browsers only allow sound after
// the person has interacted with the page, which placing a call always does.
const PULSES = 3;
const PULSE_S = 0.42;
const TONES = [660, 880];
const VOLUME = 0.25;

export function playFaultAlert(): void {
  try {
    const ctx = new AudioContext();
    void ctx.resume();
    const at = ctx.currentTime + 0.02;
    for (let p = 0; p < PULSES; p++) {
      TONES.forEach((freq, t) => {
        const start = at + p * PULSE_S + (t * PULSE_S) / 2;
        const len = PULSE_S / 2;
        const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: freq });
        const gain = new GainNode(ctx, { gain: 0 });
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(VOLUME, start + 0.015); // no clicks
        gain.gain.exponentialRampToValueAtTime(0.001, start + len);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + len);
      });
    }
    setTimeout(() => void ctx.close(), (PULSES * PULSE_S + 0.5) * 1000);
  } catch {
    // No sound is never worth breaking the console for: the plan card still shows.
  }
}
