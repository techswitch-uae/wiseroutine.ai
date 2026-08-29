/**
 * A sound when a session starts, and one when it ends.
 *
 * Synthesised rather than shipped as files. Two sine tones through the Web
 * Audio API are a few lines and no bytes; two MP3s are two assets to license,
 * two more things in the bundle, and a decode step - for a noise that lasts a
 * third of a second.
 *
 * Off by default is deliberate. This app exists to interrupt someone at work,
 * and an interruption that also makes a noise the first time, unasked, is the
 * kind of thing people uninstall over. It is a switch in Settings, and the
 * switch starts off.
 */

const KEY = "wr.chime";

/** ponytail: local to this device. Whether this Mac makes a noise is a
 *  property of where you are sitting, not of your account - the same person
 *  wants it on at home and off in an office. */
export function chimeEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(KEY, on ? "1" : "0");
  } catch {
    // Then it is off next launch. Nothing else breaks.
  }
}

/**
 * Two notes: up to begin, down to end.
 *
 * A shared context would be leaner, but one created at import time is
 * suspended by the browser until a gesture unlocks it - and the first sound
 * this ever needs to make is at the start of a slot nobody clicked. Creating
 * one per chime costs a few milliseconds and always works.
 */
export function chime(kind: "start" | "end"): void {
  if (!chimeEnabled()) return;

  try {
    const Ctx = globalThis.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const [from, to] = kind === "start" ? [523.25, 783.99] : [783.99, 523.25];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + 0.18);

    // Ramped, not switched. A gain that jumps to zero clicks, and a click is
    // the one sound guaranteed to be more annoying than the note.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.34);

    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => void ctx.close();
  } catch {
    // No audio device, a locked-down context, a browser that says no. A
    // missing chime is not worth a broken session.
  }
}
