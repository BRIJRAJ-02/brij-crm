// The visitor's country, guessed, for the public pages' phone and country questions: the hosted form's, and a
// booking page's own questions (spec 0057).

/** The visitor's country, guessed from the browser's language (en-GB is GB), for phone and country questions. */
export function guessCountry(): string | undefined {
  for (const language of navigator.languages) {
    try {
      const region = new Intl.Locale(language).maximize().region;
      if (region !== undefined && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      // A language tag the browser can't read: try the next.
    }
  }
  return undefined;
}
