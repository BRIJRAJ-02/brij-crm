/**
 * A length token's value in px at the document's current scale (spec 0071), read from the page's own CSS: lets a
 * story assert "this is drawn at size-control-lg" rather than a pixel count that changes with the scale. Stories only.
 */
export function tokenLength(name: string): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`));
}
