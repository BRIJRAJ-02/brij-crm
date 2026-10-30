// An attribute's Required When rule in its settings dialog (flow pass, 30 October 2026). The rules input can't
// carry the kind (`required` sets it), so the dialog's rules editor leaves it out and the server keeps it through
// every Save; the dialog shows it as one read only line, naming the attributes its condition looks at.
import type { AttributeDefinition } from '@crm/data';
import { strings } from './attribute-strings.ts';

/** Every attribute id a condition names, nested groups and the first hop of a path included, once each, in order. */
export function conditionAttributeIdsOf(condition: unknown): readonly string[] {
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) return;
    if ('attributeId' in node && typeof node.attributeId === 'string') found.push(node.attributeId);
    if ('path' in node && Array.isArray(node.path) && typeof node.path[0] === 'string') found.push(node.path[0]);
    if ('condition' in node) walk(node.condition);
    if ('conditions' in node && Array.isArray(node.conditions)) for (const each of node.conditions) walk(each);
  };
  walk(condition);
  return [...new Set(found)];
}

/**
 * The read only line for an attribute's Required When rule ("Required when Stage matches (set through the API)."),
 * or undefined when it has none. An attribute the reader can't see, or one gone since, isn't named.
 */
export function requiredWhenLine(
  attribute: Pick<AttributeDefinition, 'validation'> | undefined,
  attributes: readonly Pick<AttributeDefinition, 'id' | 'title'>[],
): string | undefined {
  const rule = attribute?.validation?.rules.find((each) => each.kind === 'required_when');
  if (rule === undefined) return undefined;
  const titles = conditionAttributeIdsOf(rule.condition).flatMap((id) => {
    const named = attributes.find((each) => each.id === id);
    return named === undefined ? [] : [named.title];
  });
  return strings.requiredWhenLine(titles);
}
