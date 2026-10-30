// Browser text-to-speech. Muse Voice Transcribe is speech-to-text only, so
// replies are spoken with the browser's own voices.
import type { Gate } from './gate.ts';

export function speak(text: string, gate: Gate): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.05;
    const done = () => { gate.end(); resolve(); };
    u.onend = done;
    u.onerror = done;
    gate.start();
    speechSynthesis.speak(u);
  });
}
