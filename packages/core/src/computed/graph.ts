// The dependency graph of computed attributes (spec 0015, AC-326): pure, over
// the edges `computed_inputs` holds plus the definition being written. A
// definition that would depend on itself is refused naming the first attribute
// on the loop, and a chain deeper than 3 is refused.
import { MAX_COMPUTED_DEPTH } from '@crm/contracts/computed';

/** One edge: a computed attribute reads an input (any attribute, computed or not). */
export interface ComputedEdge {
  readonly computedId: string;
  readonly inputId: string;
}

/** What the graph check answers: the new attribute's depth, or why it is refused. */
export type GraphCheck =
  { readonly ok: true; readonly depth: number } | { readonly ok: false; readonly message: string };

/**
 * Checks the definition of `computedId` reading `inputIds` against the other
 * computed attributes' edges (its own old edges are left out). Its depth is one
 * more than the deepest computed attribute it reads (a plain attribute is 0).
 * Every computed attribute that reads it, directly or through others, gets
 * deeper too, so the deepest of them must stay within 3. `titles` names each
 * attribute for the messages.
 */
export function checkGraph(
  edges: readonly ComputedEdge[],
  computedId: string,
  inputIds: readonly string[],
  titles: ReadonlyMap<string, string>,
): GraphCheck {
  const inputsOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.computedId === computedId) continue;
    const list = inputsOf.get(edge.computedId) ?? [];
    list.push(edge.inputId);
    inputsOf.set(edge.computedId, list);
  }
  inputsOf.set(computedId, [...new Set(inputIds)]);
  const titleOf = (id: string) => titles.get(id) ?? 'Another attribute';

  // A loop: some input reaches back to the attribute itself. The first input on the way names it.
  for (const input of inputsOf.get(computedId) ?? []) {
    const seen = new Set<string>();
    const stack = [input];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      if (next === computedId) {
        return { ok: false, message: `${titleOf(computedId)} would depend on itself through ${titleOf(input)}.` };
      }
      stack.push(...(inputsOf.get(next) ?? []));
    }
  }

  // Depths, now that there is no loop: a plain attribute is 0, a computed one one more than its deepest input.
  const depths = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const inputs = inputsOf.get(id);
    const depth = inputs === undefined ? 0 : 1 + Math.max(0, ...inputs.map(depthOf));
    depths.set(id, depth);
    return depth;
  };
  const deepest = Math.max(...[...inputsOf.keys()].map(depthOf));
  if (deepest > MAX_COMPUTED_DEPTH) {
    return { ok: false, message: 'Computed attributes can build on each other at most 3 deep.' };
  }
  return { ok: true, depth: depthOf(computedId) };
}

/** The computed attributes that read `changedIds`, directly or through others, in an order inputs come first. */
export function dependentsInOrder(edges: readonly ComputedEdge[], changedIds: readonly string[]): readonly string[] {
  const readers = new Map<string, string[]>();
  for (const edge of edges) {
    const list = readers.get(edge.inputId) ?? [];
    list.push(edge.computedId);
    readers.set(edge.inputId, list);
  }
  const order: string[] = [];
  const visit = (id: string, path: ReadonlySet<string>) => {
    for (const reader of readers.get(id) ?? []) {
      if (path.has(reader)) continue;
      const at = order.indexOf(reader);
      if (at !== -1) order.splice(at, 1);
      order.push(reader);
      visit(reader, new Set([...path, reader]));
    }
  };
  for (const id of changedIds) visit(id, new Set([id]));
  return order;
}
