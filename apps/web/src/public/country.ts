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

/** The region the browser's own language names outright (en-IN is IN), never one a bare language implies. */
export function statedRegion(languages: readonly string[] = navigator.languages): string | undefined {
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).region;
      if (region !== undefined && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      // A language tag the browser can't read: try the next.
    }
  }
  return undefined;
}

/**
 * Where a guest form's Country and Phone start (forms fixes 2, 6 November 2026): the region the visitor's browser
 * names (en-IN), else the workspace's country (`PublicForm.country`, the one it set or its time zone's), else what
 * the language implies (a bare "fr" is France). A bare "en" no longer starts everyone in the United States.
 */
export function formCountry(
  workspace: string | undefined,
  languages: readonly string[] = navigator.languages,
): string | undefined {
  return statedRegion(languages) ?? workspace ?? guessFrom(languages);
}

/** What the languages imply, maximized: "en" is US, "fr" is FR. */
function guessFrom(languages: readonly string[]): string | undefined {
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).maximize().region;
      if (region !== undefined && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      // A language tag the browser can't read: try the next.
    }
  }
  return undefined;
}
