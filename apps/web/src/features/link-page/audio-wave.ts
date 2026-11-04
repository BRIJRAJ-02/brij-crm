// An audio intro's waveform (spec 0068, AC-6808), drawn once in the owner's browser from the recording they picked:
// 48 bars, each one of 32 heights written as one character `0` to `v`, stored beside the recording so a visitor's page
// draws it without decoding anything. A browser that can't decode the file answers nothing, and the page draws a calm
// even shape instead.

/** How many bars a waveform has: `PROFILE_WAVE_BARS` in the contracts. */
const BARS = 48;
/** The heights a bar may take, as characters. */
const DIGITS = '0123456789abcdefghijklmnopqrstuv';

/** The waveform of a list of samples: each bar its stretch's loudest sample, scaled to the loudest bar. Pure. */
export function waveOfSamples(samples: Float32Array): string {
  const per = Math.max(1, Math.floor(samples.length / BARS));
  const peaks = Array.from({ length: BARS }, (_, bar) => {
    let loudest = 0;
    for (let at = bar * per; at < Math.min(samples.length, (bar + 1) * per); at += 1) {
      loudest = Math.max(loudest, Math.abs(samples[at] ?? 0));
    }
    return loudest;
  });
  const top = Math.max(...peaks, Number.EPSILON);
  return peaks.map((peak) => DIGITS.charAt(Math.round((peak / top) * (DIGITS.length - 1)))).join('');
}

/** The waveform of a recording, or undefined when this browser can't decode it. */
export async function waveOf(recording: Blob): Promise<string | undefined> {
  const Context = globalThis.AudioContext as typeof AudioContext | undefined;
  if (Context === undefined) return undefined;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await recording.arrayBuffer());
    return waveOfSamples(decoded.getChannelData(0));
  } catch {
    return undefined;
  } finally {
    void context.close().catch(() => undefined);
  }
}
