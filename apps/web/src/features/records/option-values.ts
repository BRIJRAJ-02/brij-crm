// A form's select or status value as an option made from it lands or is
// refused (records/options.ts): pure, so it is tested in Node.

/** A form's value with a refused option taken out: from a list, or the one choice cleared. Pure. */
export function withoutOption(held: unknown, optionId: string): unknown {
  if (Array.isArray(held)) return (held as readonly unknown[]).filter((each) => each !== optionId);
  return held === optionId ? null : held;
}

/** A form's value with a made option put in: added to a list, or replacing the one choice. Pure. */
export function withOption(held: unknown, optionId: string, isMulti: boolean): unknown {
  if (!isMulti) return optionId;
  return [...(Array.isArray(held) ? (held as readonly unknown[]) : []), optionId];
}
