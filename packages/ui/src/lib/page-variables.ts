// A public page's own values in the app's previews (spec 0060, AC-7, AC-16). On the live page they arrive as a
// stylesheet from our own origin; in the editor the same custom properties are set on the preview's root through
// the CSSOM, which the app's policy allows, so the preview draws exactly what visitors see. Only the names the
// brand and look stylesheets set pass, and only a checked hex or a `url()` to our own api, so nothing a person typed
// can reach CSS through here either.
import { useCallback, type RefCallback } from 'react';

/** Custom property pairs, as `brandProperties()` in `@crm/contracts/brand-colour` makes them. */
export type PageVariables = readonly (readonly [string, string])[];

/** The names a brand or look stylesheet sets: the accent pair's six, and the two photos. */
const NAME = /^--(?:brand-(?:accent|on-accent|link)(?:-dark)?|page-(?:cover|ground)-image)$/;
/** A checked hex, or a photo on our own api (`url("/api/…")`, no quote, bracket, colon or backslash inside). */
const VALUE = /^(?:#[0-9a-f]{6}|url\("\/api\/[A-Za-z0-9/_.?=&-]+"\))$/;

/** The pairs that pass: a known name and a checked value. Everything else is dropped. */
export function checkedPageVariables(variables: PageVariables | undefined): PageVariables {
  return (variables ?? []).filter(([name, value]) => NAME.test(name) && VALUE.test(value));
}

/**
 * A ref for a page's root that sets `variables` on it, and takes them off again when they change or the root goes.
 * Keyed by the values, not the array, so a caller building the list each render sets nothing twice.
 */
export function usePageVariables(variables: PageVariables | undefined): RefCallback<HTMLElement> {
  const key = checkedPageVariables(variables)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n');
  return useCallback(
    (element: HTMLElement | null) => {
      if (element === null || key === '') return undefined;
      const pairs = key.split('\n').map((pair) => {
        const at = pair.indexOf('=');
        return [pair.slice(0, at), pair.slice(at + 1)] as const;
      });
      for (const [name, value] of pairs) element.style.setProperty(name, value);
      return () => {
        for (const [name] of pairs) element.style.removeProperty(name);
      };
    },
    [key],
  );
}
