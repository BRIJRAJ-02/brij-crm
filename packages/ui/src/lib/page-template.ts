// The four templates every public page wears (spec 0068, AC-6801): Classic, Studio, Night and Split. A page's root
// carries `data-template`, and each page module's own stylesheet (LinkPage, BookingFrame, the hosted form's frame)
// draws the template from it: no template code in the apps, and no value written at run time.

/** The four templates, as `PAGE_TEMPLATES` in `@crm/contracts` lists them (`page-theme.test.ts` holds the two). */
export type PageTemplate = 'classic' | 'studio' | 'night' | 'split';

/** The four, in the order the editor's picker shows them. */
export const PAGE_TEMPLATE_NAMES: readonly PageTemplate[] = ['classic', 'studio', 'night', 'split'];

/**
 * The attributes a template puts on a public page's root: `data-template`, and `data-theme` where the template pins
 * light or dark (Night dark, Studio light), so the tokens inside draw that scheme whatever the visitor's own.
 * Classic and Split follow the visitor. Left out, the template is Classic.
 */
export function templateAttributes(template: PageTemplate | undefined): Readonly<Record<string, string>> {
  const chosen = template ?? 'classic';
  const scheme = chosen === 'night' ? 'dark' : chosen === 'studio' ? 'light' : undefined;
  return { 'data-template': chosen, ...(scheme === undefined ? {} : { 'data-theme': scheme }) };
}
