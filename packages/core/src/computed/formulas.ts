// Formulas in the write (spec 0015, AC-318): a formula reads only its own
// record, so a create or an edit works out the object's formulas whose inputs
// it touched in its own transaction, in dependency order, and writes each
// changed result as the system's version. The jobs use the same evaluation
// for a batch of records (a fill, or a formula reading a lookup or rollup).
import { sql } from 'drizzle-orm';
import { evaluateFormula, type FormulaInput, type FormulaNode, type FormulaResultType } from '@crm/contracts/formula';
import type { WorkspaceTx } from '@crm/db';
import { decodeValue, encodeValue, type ItemColumns } from '../engine/columns.ts';
import { uuidArray } from '../engine/ids.ts';
import { computedKindOf, currentItems, isArchivedNow, type AttributeDef } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { dependentsInOrder, type ComputedEdge } from './graph.ts';
import { writeComputedBatch, type ComputedTarget, type NextItems } from './write.ts';

/** A formula attribute as the evaluation reads it: its checked tree and the ids it references. */
interface Formula {
  readonly attribute: ComputedTarget;
  readonly ast: FormulaNode;
  readonly references: readonly string[];
  readonly resultType: FormulaResultType;
}

const RESULT_OF: Readonly<Record<string, FormulaResultType>> = {
  number: 'number',
  currency: 'currency',
  text: 'text',
  date: 'date',
  checkbox: 'bool',
};

/** The ids a tree references. */
function referencesOf(ast: FormulaNode): readonly string[] {
  const ids: string[] = [];
  const walk = (node: FormulaNode): void => {
    if (node.k === 'ref' && node.id !== undefined && !ids.includes(node.id)) ids.push(node.id);
    else if (node.k === 'call') node.args.forEach(walk);
    else if (node.k === 'binary') {
      walk(node.left);
      walk(node.right);
    } else if (node.k === 'negate') walk(node.operand);
  };
  walk(ast);
  return ids;
}

/** An attribute's formula, when it is a live formula that hasn't stopped updating. */
export function formulaOf(attribute: AttributeDef): Formula | undefined {
  if (computedKindOf(attribute) !== 'formula' || attribute.objectId === null || isArchivedNow(attribute)) {
    return undefined;
  }
  if (attribute.computedState === 'broken') return undefined;
  const resultType = RESULT_OF[attribute.type];
  const stored = attribute.computed as { readonly ast?: unknown };
  const tree: unknown = stored.ast;
  if (resultType === undefined || typeof tree !== 'object' || tree === null || !('k' in tree)) return undefined;
  // Written by `resolveFormula` from the checked source only, never taken from a caller.
  const ast = tree as FormulaNode;
  return {
    attribute: { ...attribute, objectId: attribute.objectId },
    ast,
    references: referencesOf(ast),
    resultType,
  };
}

/** The live formulas among an object's attributes, each before any formula that reads it. */
export function formulasInOrder(attributes: ReadonlyMap<string, AttributeDef>): readonly Formula[] {
  const formulas = [...attributes.values()].flatMap((attribute) => formulaOf(attribute) ?? []);
  const edges: ComputedEdge[] = formulas.flatMap((formula) =>
    formula.references.map((inputId) => ({ computedId: formula.attribute.id, inputId })),
  );
  const ids = new Set(formulas.map((formula) => formula.attribute.id));
  const order = dependentsInOrder(edges, [...new Set(edges.map((edge) => edge.inputId))]).filter((id) => ids.has(id));
  const byId = new Map(formulas.map((formula) => [formula.attribute.id, formula]));
  // A formula that reads no other formula (a constant included) can go first.
  const first = formulas.filter((formula) => !order.includes(formula.attribute.id));
  return [...first, ...order.flatMap((id) => byId.get(id) ?? [])];
}

/**
 * A formula's values for some records: their current values of the attributes
 * it references (system columns from the record's row), each select's and
 * status's options by label, evaluated, encoded in the result type.
 */
export async function formulaValues(
  tx: WorkspaceTx,
  formula: Formula,
  attributes: ReadonlyMap<string, AttributeDef>,
  ownerIds: readonly string[],
): Promise<NextItems> {
  if (ownerIds.length === 0) return new Map();
  const referenced = formula.references.flatMap((id) => attributes.get(id) ?? []);
  const stored = referenced.filter((attribute) => attribute.systemColumn === null);
  const items = await currentItems(
    tx,
    ownerIds,
    stored.map((attribute) => attribute.id),
  );
  const optionAttributes = stored.filter((attribute) => attribute.type === 'select' || attribute.type === 'status');
  const labels = new Map<string, string>();
  if (optionAttributes.length > 0) {
    const options = await tx.execute<{ id: string; label: string }>(sql`
      select id::text as id, label from attribute_options
      where attribute_id = any(${uuidArray(optionAttributes.map((attribute) => attribute.id))})
    `);
    for (const row of options.rows) labels.set(row.id, row.label);
  }
  const system = referenced.filter((attribute) => attribute.systemColumn !== null);
  const rows = new Map<string, { created_at: string; updated_at: string }>();
  if (system.length > 0) {
    const read = await tx.execute<{ id: string; created_at: string; updated_at: string }>(sql`
      select id::text as id,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from records where id = any(${uuidArray(ownerIds)})
    `);
    for (const row of read.rows) rows.set(row.id, row);
  }
  const held = new Map<string, (typeof items)[number][]>();
  for (const item of items) {
    const key = `${item.ownerId}:${item.attributeId}`;
    const list = held.get(key) ?? [];
    list.push(item);
    held.set(key, list);
  }
  const next = new Map<string, readonly ItemColumns[]>();
  for (const ownerId of ownerIds) {
    const inputs = new Map<string, FormulaInput>();
    for (const attribute of stored) {
      const cell = held.get(`${ownerId}:${attribute.id}`) ?? [];
      inputs.set(attribute.id, { type: attribute.type, value: decodeValue(attribute.type, attribute.isMulti, cell) });
    }
    for (const attribute of system) {
      const row = rows.get(ownerId);
      const value =
        attribute.systemColumn === 'created_at'
          ? row?.created_at
          : attribute.systemColumn === 'updated_at'
            ? row?.updated_at
            : undefined;
      inputs.set(attribute.id, { type: attribute.type, value: value ?? null });
    }
    const value = evaluateFormula(formula.ast, inputs, labels, formula.resultType);
    next.set(ownerId, encodeValue(formula.attribute.type, value));
  }
  return next;
}

/**
 * Works out a record's formulas after its write (AC-318): every live formula
 * on a create, otherwise those reading an attribute the write changed (or
 * Updated at, which every value change moves), and then those reading a
 * formula that changed, in dependency order. Each result rides the write: its
 * value change goes out with the save's event and its `mutationId`.
 */
export async function writeFormulas(
  context: WriteContext,
  input: {
    readonly recordId: string;
    readonly attributes: ReadonlyMap<string, AttributeDef>;
    readonly written: ReadonlySet<string>;
    readonly isCreate: boolean;
  },
): Promise<void> {
  const formulas = formulasInOrder(input.attributes);
  if (formulas.length === 0) return;
  if (!input.isCreate && input.written.size === 0) return;
  const updatedAt = [...input.attributes.values()].find((attribute) => attribute.systemColumn === 'updated_at')?.id;
  const touched = new Set(input.written);
  if (updatedAt !== undefined && input.written.size > 0) touched.add(updatedAt);
  for (const formula of formulas) {
    if (!input.isCreate && !formula.references.some((id) => touched.has(id))) continue;
    const changed = await writeComputedBatch(context, formula.attribute, [input.recordId], (live) =>
      formulaValues(context.tx, formula, input.attributes, live),
    );
    if (changed.length > 0) touched.add(formula.attribute.id);
  }
}

/**
 * Works out again, for some records, the formulas that read `changedIds`
 * (a lookup or rollup a job just rewrote), and those reading them in turn.
 */
export async function refreshFormulas(
  context: WriteContext,
  attributes: ReadonlyMap<string, AttributeDef>,
  changedIds: readonly string[],
  recordIds: readonly string[],
): Promise<void> {
  if (recordIds.length === 0) return;
  const touched = new Set(changedIds);
  for (const formula of formulasInOrder(attributes)) {
    if (!formula.references.some((id) => touched.has(id))) continue;
    const changed = await writeComputedBatch(context, formula.attribute, recordIds, (live) =>
      formulaValues(context.tx, formula, attributes, live),
    );
    if (changed.length > 0) touched.add(formula.attribute.id);
  }
}
