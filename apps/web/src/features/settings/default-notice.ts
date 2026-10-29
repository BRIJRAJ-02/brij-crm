// What archiving an option does to the default that names it (late trap #34): new records quietly stopped getting
// it, and nobody was told. Pure, so the rule is tested apart from the dialog.
import type { AttributeDefinition } from '@crm/data';
import { strings } from './attribute-strings.ts';

/**
 * What archiving `optionId` does to the attribute's default, when the default names it (late trap #34), or
 * undefined: a required single select starts new records at its first live option instead, any other stops filling
 * it. Restoring the option brings the default back, since the stored default is left alone.
 */
export function defaultArchivedNotice(
  attribute: Pick<AttributeDefinition, 'title' | 'isRequired' | 'defaultValue'>,
  options: readonly { readonly id: string; readonly label: string; readonly isArchived?: boolean | undefined }[],
  optionId: string,
): string | undefined {
  const named = attribute.defaultValue;
  if (named?.kind !== 'static') return undefined;
  const ids = Array.isArray(named.value) ? named.value : [named.value];
  if (!ids.includes(optionId)) return undefined;
  const label = options.find((option) => option.id === optionId)?.label;
  if (label === undefined) return undefined;
  const others = ids.filter(
    (id) => id !== optionId && options.some((option) => option.id === id && option.isArchived !== true),
  );
  if (others.length > 0) return strings.defaultOptionDropped(label, attribute.title);
  const first = options.find((option) => option.id !== optionId && option.isArchived !== true);
  return attribute.isRequired && !Array.isArray(named.value) && first !== undefined
    ? strings.defaultOptionMoved(label, attribute.title, first.label)
    : strings.defaultOptionGone(label, attribute.title);
}
