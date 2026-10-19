// What the forms services share (spec 0023): reading a form and its versions,
// and turning a version's document into what a visitor's browser renders
// (`PublicForm`), from the attribute definitions as they are now (types,
// options, rules), the one place the hosted page and the submit check both
// read it from.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  FormDocument,
  isFormQuestionType,
  type FormQuestionType,
  type PublicBlock,
  type PublicForm,
  type PublicQuestion,
  type QuestionBlock,
} from '@crm/contracts';
import { Hue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { loadRules } from '../validation/rules.ts';

const { attributeOptions, forms, formVersions } = schema;

/** A form row as the services read it. */
export interface FormRow {
  readonly id: string;
  readonly kind: string;
  readonly status: 'draft' | 'live' | 'paused' | 'archived';
  readonly name: string;
  readonly mainObjectId: string;
  readonly publicKey: string;
  readonly draftVersionId: string | null;
  readonly liveVersionId: string | null;
  readonly revision: number;
  readonly createdById: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A moment as fixed width UTC text with milliseconds, as the views carry it. */
export const millis = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

const FORM_COLUMNS = {
  id: forms.id,
  kind: forms.kind,
  status: sql<FormRow['status']>`${forms.status}`,
  name: forms.name,
  mainObjectId: forms.mainObjectId,
  publicKey: forms.publicKey,
  draftVersionId: forms.draftVersionId,
  liveVersionId: forms.liveVersionId,
  revision: forms.revision,
  createdById: forms.createdById,
  createdAt: sql<string>`to_char(${forms.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  updatedAt: sql<string>`to_char(${forms.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
};

/** One form, locked against other writers when `lock` says so, or undefined. */
export async function loadForm(tx: WorkspaceTx, formId: string, lock = false): Promise<FormRow | undefined> {
  const query = tx.select(FORM_COLUMNS).from(forms).where(eq(forms.id, formId));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** A version as the services read it: its number, its document (parsed), and whether it is published. */
export interface VersionRow {
  readonly id: string;
  readonly number: number;
  readonly document: FormDocument;
  readonly published: boolean;
}

/** Parses a stored document. One that no longer parses is a programming error (documents are checked on save). */
export function parseDocument(stored: unknown): FormDocument {
  return FormDocument.parse(stored);
}

/** Versions by id. */
export async function loadVersions(tx: WorkspaceTx, ids: readonly string[]): Promise<ReadonlyMap<string, VersionRow>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: formVersions.id,
      number: formVersions.number,
      document: formVersions.document,
      publishedAt: formVersions.publishedAt,
    })
    .from(formVersions)
    .where(inArray(formVersions.id, [...ids]));
  return new Map(
    rows.map((row) => [
      row.id,
      { id: row.id, number: row.number, document: parseDocument(row.document), published: row.publishedAt !== null },
    ]),
  );
}

/** One version of a form by its number, or undefined. */
export async function versionByNumber(
  tx: WorkspaceTx,
  formId: string,
  number: number,
): Promise<VersionRow | undefined> {
  const [row] = await tx
    .select({ id: formVersions.id })
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId), eq(formVersions.number, number)));
  return row === undefined ? undefined : (await loadVersions(tx, [row.id])).get(row.id);
}

/** The attribute a question's answer writes, when it maps one that is live and has a public editor. */
export function questionAttribute(
  question: QuestionBlock,
  attributes: ReadonlyMap<string, AttributeDef>,
): AttributeDef | undefined {
  if (!('attributeId' in question.target)) return undefined;
  const attribute = attributes.get(question.target.attributeId);
  if (attribute === undefined || attribute.isSystem || isArchivedNow(attribute)) return undefined;
  return isFormQuestionType(attribute.type) ? attribute : undefined;
}

/** The type a question renders as: its attribute's, or its form only type. */
export function questionType(
  question: QuestionBlock,
  attribute: AttributeDef | undefined,
): FormQuestionType | undefined {
  if ('formOnly' in question.target) return question.target.type;
  return attribute !== undefined && isFormQuestionType(attribute.type) ? attribute.type : undefined;
}

/** The live options of select attributes, in their order, by attribute. */
async function liveOptions(
  tx: WorkspaceTx,
  attributeIds: readonly string[],
): Promise<ReadonlyMap<string, readonly { id: string; label: string; hue?: Hue }[]>> {
  if (attributeIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: attributeOptions.id,
      attributeId: attributeOptions.attributeId,
      label: attributeOptions.label,
      hue: attributeOptions.hue,
    })
    .from(attributeOptions)
    .where(and(inArray(attributeOptions.attributeId, [...attributeIds]), isNull(attributeOptions.archivedAt)))
    .orderBy(asc(attributeOptions.position), asc(attributeOptions.id));
  const byAttribute = new Map<string, { id: string; label: string; hue?: Hue }[]>();
  for (const row of rows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    const hue = Hue.safeParse(row.hue);
    list.push({ id: row.id, label: row.label, ...(hue.success ? { hue: hue.data } : {}) });
    byAttribute.set(row.attributeId, list);
  }
  return byAttribute;
}

/** What `publicFormOf` reads besides the document: the form's key and status, and settings from the api. */
export interface PublicFormContext {
  readonly publicKey: string;
  readonly status: 'live' | 'paused';
  readonly versionNumber: number;
  readonly recaptchaSiteKey?: string;
  /** Question ids a visitor one version behind never saw: they aren't required of them (spec 0023, version tolerance). */
  readonly notRequired?: ReadonlySet<string>;
}

/**
 * A version's document as the hosted page renders it (0023-public-surface.md):
 * each question with its type, options and rules (those with no condition,
 * keyed by the question), and no attribute ids, mappings, owner or routing. A
 * question whose attribute was archived, deleted or changed to a type with
 * no public editor is left out (its answer can't be written, AC-551).
 */
export async function publicFormOf(
  tx: WorkspaceTx,
  mainObjectId: string,
  document: FormDocument,
  context: PublicFormContext,
): Promise<PublicForm> {
  const attributes = await loadAttributes(tx, mainObjectId);
  const questions = document.steps.flatMap((step) =>
    step.blocks.flatMap((block) => (block.kind === 'question' ? [block] : [])),
  );
  const mapped = questions.flatMap((question) => {
    const attribute = questionAttribute(question, attributes);
    return attribute === undefined ? [] : [attribute];
  });
  const options = await liveOptions(
    tx,
    mapped.filter((attribute) => attribute.type === 'select').map((attribute) => attribute.id),
  );
  const rules = mapped.some((attribute) => attribute.ruleCount > 0) ? (await loadRules(tx, mainObjectId)).rules : [];
  const toQuestion = (question: QuestionBlock): PublicQuestion | undefined => {
    const attribute = questionAttribute(question, attributes);
    const type = questionType(question, attribute);
    if (type === undefined || ('attributeId' in question.target && attribute === undefined)) return undefined;
    const own =
      attribute === undefined
        ? []
        : rules
            .filter((rule) => rule.attributeId === attribute.id && rule.condition === undefined)
            .map((rule) => ({
              id: rule.id,
              kind: rule.kind,
              params: rule.params,
              ...(rule.message === undefined ? {} : { message: rule.message }),
              position: rule.position,
            }));
    const choices = attribute === undefined ? undefined : options.get(attribute.id);
    return {
      kind: 'question',
      id: question.id,
      label: question.label,
      ...(question.help === undefined ? {} : { help: question.help }),
      required: question.required && context.notRequired?.has(question.id) !== true,
      type,
      // A visitor answers one email, domain or address even where the attribute holds several; a select keeps its kind.
      isMulti: type === 'select' && attribute?.isMulti === true,
      ...(type === 'select' ? { options: [...(choices ?? [])] } : {}),
      ...(question.prefillKey === undefined ? {} : { prefillKey: question.prefillKey }),
      ...(own.length === 0 ? {} : { rules: own }),
    };
  };
  const steps = document.steps.map((step) => ({
    id: step.id,
    ...(step.title === undefined ? {} : { title: step.title }),
    blocks: step.blocks.flatMap((block): PublicBlock[] => {
      if (block.kind !== 'question') return [block];
      const question = toQuestion(block);
      return question === undefined ? [] : [question];
    }),
  }));
  return {
    key: context.publicKey,
    status: context.status,
    versionNumber: context.versionNumber,
    title: document.style.title,
    ...(document.style.description === undefined ? {} : { description: document.style.description }),
    buttonText: document.style.buttonText,
    language: document.style.language,
    steps,
    indexing: false,
    ...(context.recaptchaSiteKey === undefined ? {} : { recaptchaSiteKey: context.recaptchaSiteKey }),
  };
}
