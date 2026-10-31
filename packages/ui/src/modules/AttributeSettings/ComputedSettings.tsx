// The computed kinds' settings in AttributeSettings (spec 0015): a lookup and
// a rollup read as one sentence with its blanks to pick ("From [Company] show
// [Industry]", "[Sum] of [Amount] across [Deals]"), a formula is typed in the
// FormulaEditor, and each ends with the preview: a few records and the values
// they would get. Presentational: the sides, attributes and preview come in.
import {
  lookupTargetProblem,
  ROLLUP_CALCS,
  rollupTakesTarget,
  rollupTargetProblem,
  type ComputedKind,
  type ComputedSource,
  type RollupCalc,
} from '@crm/contracts/computed';
import { checkFormulaSource, resultWords, type FormulaAttribute } from '@crm/contracts/formula';
import type { AttributeType, FilterGroup, RecordRefDisplay } from '@crm/contracts/values';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { RecordChip } from '../../atoms/RecordChip/RecordChip.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { AttributeDisplay, type AttributeDisplayProps } from '../../fields/AttributeDisplay.tsx';
import { fieldTypeOf, typeLabelOf } from '../../fields/registry.ts';
import type { FieldAttribute } from '../../fields/types.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { EmptyState } from '../../molecules/EmptyState/EmptyState.tsx';
import { Select, type SelectItem } from '../../molecules/Select/Select.tsx';
import { Sentence } from '../../molecules/Sentence/Sentence.tsx';
import { Table } from '../../molecules/Table/Table.tsx';
import { FilterBuilder } from '../FilterBuilder/FilterBuilder.tsx';
import { FormulaEditor } from '../FormulaEditor/FormulaEditor.tsx';
import { strings } from './strings.ts';

/** A computed definition as the dialog sends it (`ComputedDefinitionInput` in `@crm/contracts`). */
export type ComputedDraft =
  | { readonly kind: 'lookup'; readonly via: string; readonly target: string }
  | {
      readonly kind: 'rollup';
      readonly via: string;
      readonly calc: RollupCalc;
      readonly target?: string;
      readonly where?: FilterGroup;
    }
  | { readonly kind: 'formula'; readonly source: string };

/** An attribute of the related object, as a lookup or rollup picks it. */
export interface ComputedFarAttribute extends ComputedSource {
  readonly id: string;
  readonly title: string;
  readonly type: AttributeType;
}

/** One of this object's relationship sides a lookup or rollup can follow, with the related object's attributes. */
export interface ComputedSide {
  readonly id: string;
  /** The side's name on this object ("Company", "Deals"). */
  readonly title: string;
  readonly holdsMany: boolean;
  readonly attributes: readonly ComputedFarAttribute[];
  /** The related object's attributes as the FilterBuilder takes them, for Count where. None: no condition. */
  readonly filterAttributes?: readonly FieldAttribute[];
}

/** The preview as the screen holds it (`data.computed.preview`). */
export interface ComputedPreviewState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly result?: {
    readonly resultType?: { readonly type: AttributeType; readonly isMulti: boolean };
    readonly error?: { readonly message: string };
    readonly samples: readonly { readonly record: RecordRefDisplay; readonly value: unknown }[];
  };
}

/** What the computed settings need from the screen (spec 0015). */
export interface AttributeSettingsComputed {
  /** This object's plural name, for the empty state. */
  readonly pluralName: string;
  /** This object's live two way relationship sides. */
  readonly sides: readonly ComputedSide[];
  /** This object's attributes a formula may name (archived ones marked, the formula's own left out). */
  readonly formulaAttributes: readonly FormulaAttribute[];
  readonly preview: ComputedPreviewState;
  readonly onRetryPreview: () => void;
  /** Each change of the definition (undefined while it is incomplete), so the screen asks the preview. */
  readonly onDraftChange: (draft: ComputedDraft | undefined) => void;
  /** Opens spec 0014's relationship dialog, from the empty state. None for someone who can't make one. */
  readonly onNewRelationship?: () => void;
  /** Editing a fill that failed: works the values out again. */
  readonly onRefill?: () => void;
}

/** Props for the computed settings. */
interface ComputedSettingsProps {
  readonly kind: ComputedKind;
  readonly computed: AttributeSettingsComputed;
  /** Editing: the definition it holds now. */
  readonly initial?: ComputedDraft;
  /** Editing, while it has stopped updating: why. */
  readonly brokenReason?: string;
  readonly isReadOnly: boolean;
  readonly error: string | undefined;
  /** The definition as it stands, or undefined while incomplete or invalid. */
  readonly onChange: (draft: ComputedDraft | undefined) => void;
}

const sideItem = (side: ComputedSide): SelectItem => ({ id: side.id, label: side.title, icon: 'link' });
const fieldItem = (attribute: ComputedFarAttribute): SelectItem => ({
  id: attribute.id,
  label: attribute.title,
  icon: fieldTypeOf(attribute.type).icon,
});

/** The settings of a Lookup, Rollup or Formula, with the preview under them. */
export function ComputedSettings({
  kind,
  computed,
  initial,
  brokenReason,
  isReadOnly,
  error,
  onChange,
}: ComputedSettingsProps) {
  const { sides } = computed;
  const startVia = initial !== undefined && 'via' in initial ? initial.via : sides[0]?.id;
  const [via, setVia] = useState<string | undefined>(startVia);
  const [calc, setCalc] = useState<RollupCalc>(initial?.kind === 'rollup' ? initial.calc : 'count');
  const [target, setTarget] = useState<string | undefined>(
    initial !== undefined && 'target' in initial ? initial.target : undefined,
  );
  const [where, setWhere] = useState<FilterGroup>(
    initial?.kind === 'rollup' && initial.where !== undefined ? initial.where : { conjunction: 'and', conditions: [] },
  );
  const [source, setSource] = useState(initial?.kind === 'formula' ? initial.source : '');
  const side = sides.find((each) => each.id === via) ?? sides[0];

  // What the chosen side offers: a lookup takes any type it can show, a rollup what its calculation reads.
  const offered = useMemo(
    () =>
      (side?.attributes ?? []).filter((attribute) =>
        kind === 'lookup'
          ? lookupTargetProblem(attribute, side?.holdsMany ?? false) === undefined
          : rollupTargetProblem(calc, attribute) === undefined,
      ),
    [side, kind, calc],
  );
  // The first that fits until one is picked, so the sentence is never half done.
  const chosen = offered.find((attribute) => attribute.id === target) ?? offered[0];

  const formulaBySlug = useMemo(
    () => new Map(computed.formulaAttributes.map((attribute) => [attribute.apiSlug, attribute])),
    [computed.formulaAttributes],
  );
  const checked = useMemo(
    () => (kind === 'formula' && source.trim() !== '' ? checkFormulaSource(source, formulaBySlug) : undefined),
    [kind, source, formulaBySlug],
  );

  const draft = useMemo((): ComputedDraft | undefined => {
    if (kind === 'formula') return checked?.ok === true ? { kind: 'formula', source } : undefined;
    if (side === undefined) return undefined;
    if (kind === 'lookup')
      return chosen === undefined ? undefined : { kind: 'lookup', via: side.id, target: chosen.id };
    if (rollupTakesTarget(calc) && chosen === undefined) return undefined;
    return {
      kind: 'rollup',
      via: side.id,
      calc,
      ...(rollupTakesTarget(calc) && chosen !== undefined ? { target: chosen.id } : {}),
      ...(calc === 'count_where' && where.conditions.length > 0 ? { where } : {}),
    };
  }, [kind, checked?.ok, source, side, chosen, calc, where]);
  const draftKey = JSON.stringify(draft ?? null);
  const { onDraftChange } = computed;
  useEffect(() => {
    onChange(draft);
    onDraftChange(draft);
    // One call per definition, however often the screen renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const brokenNote =
    brokenReason === undefined ? undefined : (
      <Callout tone="danger">
        {strings.notUpdating(brokenReason)}
        {computed.onRefill !== undefined && (
          <Button variant="link" onPress={computed.onRefill}>
            {strings.retry}
          </Button>
        )}
      </Callout>
    );

  if (kind !== 'formula' && sides.length === 0) {
    return (
      <EmptyState
        title={strings.noRelationships(computed.pluralName)}
        icon="link"
        {...(computed.onNewRelationship === undefined
          ? {}
          : {
              actions: (
                <Button variant="secondary" onPress={computed.onNewRelationship}>
                  {strings.newRelationship}
                </Button>
              ),
            })}
      />
    );
  }

  const throughSelect = (
    <Select
      label={strings.through}
      isLabelHidden
      variant="inline"
      items={sides.map(sideItem)}
      value={side?.id ?? null}
      onChange={(id) => {
        if (id !== null) setVia(id);
      }}
      {...(isReadOnly ? { isReadOnly: true } : {})}
    />
  );
  const attributeSelect =
    offered.length === 0 ? (
      <span>{strings.noFields}</span>
    ) : (
      <Select
        label={strings.attribute}
        isLabelHidden
        variant="inline"
        items={offered.map(fieldItem)}
        value={chosen?.id ?? null}
        onChange={(id) => {
          if (id !== null) setTarget(id);
        }}
        {...(isReadOnly ? { isReadOnly: true } : {})}
      />
    );
  return (
    <>
      {brokenNote}
      {kind === 'lookup' && (
        <Sentence lead={strings.from}>
          {throughSelect}
          {strings.show}
          {attributeSelect}
        </Sentence>
      )}
      {kind === 'rollup' && (
        <>
          <Sentence lead={strings.showLead}>
            <Select
              label={strings.calculation}
              isLabelHidden
              variant="inline"
              items={ROLLUP_CALCS.map((each) => ({ id: each, label: strings.calcs[each] ?? each }))}
              value={calc}
              onChange={(id) => {
                const next = ROLLUP_CALCS.find((each) => each === id);
                if (next !== undefined) setCalc(next);
              }}
              {...(isReadOnly ? { isReadOnly: true } : {})}
            />
            {rollupTakesTarget(calc) && (
              <>
                {strings.of}
                {attributeSelect}
              </>
            )}
            {strings.across}
            {throughSelect}
          </Sentence>
          {calc === 'count_where' && side?.filterAttributes !== undefined && (
            <FilterBuilder
              attributes={side.filterAttributes}
              value={where}
              onChange={setWhere}
              {...(isReadOnly ? { isReadOnly: true } : {})}
            />
          )}
        </>
      )}
      {kind === 'formula' && (
        <FormulaEditor
          value={source}
          onChange={setSource}
          attributes={computed.formulaAttributes
            .filter((attribute) => !attribute.isArchived)
            .map((attribute) => ({
              apiSlug: attribute.apiSlug,
              title: attribute.title,
              type: attribute.type as AttributeType,
            }))}
          check={
            checked === undefined
              ? undefined
              : checked.ok
                ? { result: resultWords(checked.type) }
                : { error: formulaCheckText(checked.error) }
          }
          {...(isReadOnly ? { isReadOnly: true } : {})}
        />
      )}
      {error !== undefined && <Callout tone="danger">{error}</Callout>}
      {draft !== undefined && <Preview preview={computed.preview} onRetry={computed.onRetryPreview} />}
    </>
  );
}

/** A formula error as the check line says it, its character counted from 1. */
function formulaCheckText(error: { readonly message: string; readonly position: number }): string {
  return `${error.message.replace(/\.$/, '')} at character ${String(error.position + 1)}.`;
}

/** The preview: up to 5 records and what they'd get, a spinner while a newer answer is out, Try again on failure. */
function Preview({ preview, onRetry }: { readonly preview: ComputedPreviewState; readonly onRetry: () => void }) {
  const { status, result } = preview;
  if (status === 'error' && result === undefined) {
    return (
      <Callout tone="danger">
        {strings.previewFailed}
        <Button variant="link" onPress={onRetry}>
          {strings.retry}
        </Button>
      </Callout>
    );
  }
  if (result?.error !== undefined) return <Callout tone="danger">{result.error.message}</Callout>;
  const resultType = result?.resultType;
  if (status === 'idle' || (result !== undefined && result.samples.length === 0)) return null;
  const attribute: FieldAttribute = {
    id: 'preview',
    name: strings.preview,
    type: resultType?.type ?? 'text',
    allowMultiple: resultType?.isMulti ?? false,
    isRequired: false,
    isUnique: false,
    isReadOnly: true,
  };
  const rows = (result?.samples ?? []).map((sample) => ({ id: sample.record.recordId, ...sample }));
  return (
    <>
      {status === 'loading' && result !== undefined && <Spinner label={strings.workingOut} />}
      <Table
        label={strings.preview}
        columns={[
          { id: 'record', label: strings.record, isRowHeader: true },
          { id: 'value', label: resultType === undefined ? strings.preview : typeLabelOf(resultType.type) },
        ]}
        rows={rows}
        getRowId={(row) => row.id}
        isLoading={result === undefined}
        renderCell={(row, column) =>
          column === 'record' ? (
            <RecordChip display={row.record} isFlat />
          ) : (
            <AttributeDisplay
              attribute={attribute}
              value={row.value as AttributeDisplayProps['value']}
              surface="cell"
            />
          )
        }
      />
    </>
  );
}
