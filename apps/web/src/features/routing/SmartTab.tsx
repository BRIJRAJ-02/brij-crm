// Brief
// Purpose: Routing › Smart (spec 0037, AC-1361 to AC-1364, AC-1374): how the free reps are ordered once the rules have chosen who may host.
// Main task: pick the ranking mode, set the fairness allowance and read the bound it gives, then join answers to skills as fit links.
// Leaves out: the holdout, segment attributes, Learn from and each page's objective (Insights, L9); the rules themselves (each surface's Routing card).
import {
  isDataError,
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type FitLink,
  type RoutingSkill,
  type SmartMode,
} from '@crm/data';
import { FIT_LINKS_MAX, SMART_MODE_DEFAULT, TILT_PERCENT_DEFAULT, TILT_PERCENT_MAX } from '@crm/data/forms';
import { useRoutingSettings, useRoutingSkills } from '@crm/data/react';
import {
  AttributeDisplay,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  SegmentedControl,
  SettingsStack,
  Skeleton,
  Select,
  Table,
  TruncatedText,
  focusLater,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useMemo, useRef, useState } from 'react';
import { smartStrings as strings } from './smart-strings.ts';

/**
 * One select or status field a fit link may read (AC-1362): its definition,
 * so an answer draws through the field set's one display for its type, and
 * the label the pickers show, which names its object as well as the field.
 */
export interface FitField {
  readonly id: string;
  readonly label: string;
  readonly attribute: AttributeDefinition;
}

/** Props for SmartTab. */
export interface SmartTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The select and status fields on People, Companies and Deals the reader can see, each with its live options. */
  readonly fields: readonly FitField[];
  /** Takes the person to Routing › Skills, where a fit link's skill is made. */
  readonly onSkills: () => void;
  readonly toasts: Toasts;
}

/** One empty list, so the maps below don't rebuild on every render while the skills load. */
const EMPTY_SKILLS: readonly RoutingSkill[] = [];

const FIT_COLUMNS: readonly TableColumn[] = [
  { id: 'field', label: strings.field, isRowHeader: true, isInline: true, size: 'fill' },
  { id: 'option', label: strings.option, isInline: true },
  { id: 'skill', label: strings.skill, isInline: true },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', showsOnHover: true },
];

/** The rotation window the sentence speaks of: 30 days, the default every rotation starts with. */
const WINDOW_DAYS = 30;

/** Routing › Smart. */
export function SmartTab({ data, slug, fields, onSkills, toasts }: SmartTabProps) {
  const held = useMemo(() => data.routing.settings.view(slug), [data, slug]);
  const state = useRoutingSettings(held);
  const skillsHeld = useMemo(() => data.routing.skills.view(slug), [data, slug]);
  const skillsState = useRoutingSkills(skillsHeld);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FitLink | undefined>();
  const addRef = useRef<HTMLButtonElement>(null);
  // Where focus goes when Add link is disabled (the 100th link), so a keyboard reader never lands on the body.
  const tableRef = useRef<HTMLDivElement>(null);
  const skills = skillsState.status === 'ready' ? skillsState.value.skills : EMPTY_SKILLS;
  // One map each, not a scan per row: a workspace may hold 100 fit links against every select field of three
  // objects. Above the states below, so every render calls the same hooks in the same order.
  const byField = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const byOption = useMemo(
    () => new Map(fields.flatMap((field) => (field.attribute.options ?? []).map((each) => [each.id, each] as const))),
    [fields],
  );
  const bySkill = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={() => held.reload()}>
        {state.message === '' ? strings.loadFailedText : state.message}
      </EmptyState>
    );
  }
  // The skills read has its own states: without them a tab still loading, or one whose read failed, would say
  // "No skills yet" and disable Add link, which is simply untrue.
  if (skillsState.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailedSkills} onRetry={() => skillsHeld.reload()}>
        {skillsState.message === '' ? strings.loadFailedText : skillsState.message}
      </EmptyState>
    );
  }
  const isLoading = state.status === 'loading' || skillsState.status === 'loading';
  const settings = state.status === 'ready' ? state.value : undefined;
  const mode: SmartMode = settings?.smartMode ?? SMART_MODE_DEFAULT;
  const tiltPercent = settings?.tiltPercent ?? TILT_PERCENT_DEFAULT;
  const links = settings?.fit ?? [];
  const fieldOf = (id: string) => byField.get(id);
  const optionOf = (link: FitLink) => byOption.get(link.optionId);
  const skillOf = (link: FitLink) => bySkill.get(link.skillId);
  const save = (change: Parameters<typeof data.routing.settings.set>[1]) => {
    data.routing.settings.set(slug, change).catch((error: unknown) => {
      toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failed });
    });
  };
  return (
    <SettingsStack>
      <Card title={strings.mode} description={strings.modeHint[mode]} isBusy={isLoading}>
        {isLoading ? (
          <Skeleton shape="field" />
        ) : (
          <SegmentedControl
            label={strings.mode}
            value={mode}
            segments={[
              { value: 'off', label: strings.modes.off },
              { value: 'fit', label: strings.modes.fit },
              { value: 'learn', label: strings.modes.learn },
            ]}
            onChange={(value) => {
              if (value === 'off' || value === 'fit' || value === 'learn') save({ smartMode: value });
            }}
          />
        )}
      </Card>
      <Card title={strings.allowance} description={strings.allowanceHint} isBusy={isLoading}>
        {isLoading ? (
          <Skeleton shape="field" />
        ) : (
          <Allowance
            tiltPercent={tiltPercent}
            isDisabled={false}
            // The bound in plain words, live under the field (AC-1364).
            hint={
              mode === 'off'
                ? strings.boundOff
                : tiltPercent === 0
                  ? strings.boundStrict
                  : strings.bound(tiltPercent, WINDOW_DAYS)
            }
            onSave={(next, wasClamped) => {
              save({ tiltPercent: next });
              if (wasClamped) toasts.toast({ tone: 'info', message: strings.clamped(next) });
            }}
          />
        )}
      </Card>
      <Card
        title={strings.fit}
        description={
          links.length >= FIT_LINKS_MAX
            ? strings.limit(FIT_LINKS_MAX)
            : mode === 'off'
              ? `${strings.fitHint} ${strings.fitUnused}`
              : strings.fitHint
        }
        actions={
          <Button
            ref={addRef}
            size="sm"
            variant="secondary"
            icon="plus"
            isDisabled={isLoading || fields.length === 0 || skills.length === 0 || links.length >= FIT_LINKS_MAX}
            onPress={() => setAdding(true)}
          >
            {strings.addLink}
          </Button>
        }
      >
        <Table
          label={strings.fitTable}
          columns={FIT_COLUMNS}
          rows={links}
          getRowId={(link) => `${link.attributeId}:${link.optionId}:${link.skillId}`}
          isLoading={isLoading}
          // On a phone the three columns and the Remove button don't fit side by side: the rows scroll across.
          isScrollable
          emptyState={
            fields.length === 0 ? (
              <EmptyState icon="tag" title={strings.noFieldsTitle}>
                {strings.noFields}
              </EmptyState>
            ) : skills.length === 0 ? (
              <EmptyState
                icon="tag"
                title={strings.noSkillsTitle}
                actions={
                  <Button variant="secondary" icon="arrow-right" onPress={onSkills}>
                    {strings.goToSkills}
                  </Button>
                }
              >
                {strings.noSkills}
              </EmptyState>
            ) : (
              <EmptyState
                icon="tag"
                title={strings.noFit}
                actions={
                  <Button variant="secondary" icon="plus" onPress={() => setAdding(true)}>
                    {strings.addLink}
                  </Button>
                }
              >
                {strings.noFitText}
              </EmptyState>
            )
          }
          renderCell={(link, column) => {
            switch (column) {
              case 'field':
                return <TruncatedText>{fieldOf(link.attributeId)?.label ?? ''}</TruncatedText>;
              case 'option': {
                // An answer draws through the field set, so it looks the same here as in a cell or on a record.
                const field = fieldOf(link.attributeId);
                return field === undefined ? null : (
                  <AttributeDisplay
                    attribute={toFieldAttribute(field.attribute)}
                    value={link.optionId}
                    surface="cell"
                  />
                );
              }
              case 'skill':
                return <TruncatedText>{skillOf(link)?.name ?? ''}</TruncatedText>;
              default:
                return (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    label={strings.removeLinkOf(optionOf(link)?.label ?? '', skillOf(link)?.name ?? '')}
                    onPress={() => setRemoving(link)}
                  />
                );
            }
          }}
        />
      </Card>
      {adding && (
        <AddFitLink
          fields={fields}
          skills={skills}
          links={links}
          onAdd={(link) => save({ fit: [...links, link] })}
          onClose={() => {
            setAdding(false);
            focusLater(() => (addRef.current?.disabled === true ? tableRef.current : addRef.current));
          }}
        />
      )}
      {removing !== undefined && (
        <Modal
          title={strings.removeTitle}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setRemoving(undefined);
          }}
          actions={
            <>
              <Button slot="close">{strings.cancel}</Button>
              <Button
                variant="danger"
                onPress={() => {
                  const gone = removing;
                  setRemoving(undefined);
                  save({
                    fit: links.filter(
                      (each) =>
                        !(
                          each.attributeId === gone.attributeId &&
                          each.optionId === gone.optionId &&
                          each.skillId === gone.skillId
                        ),
                    ),
                  });
                  toasts.toast({ tone: 'success', message: strings.removed });
                  focusLater(() => addRef.current ?? tableRef.current);
                }}
              >
                {strings.remove}
              </Button>
            </>
          }
        >
          {strings.removeText(
            fieldOf(removing.attributeId)?.label ?? '',
            optionOf(removing)?.label ?? '',
            skillOf(removing)?.name ?? '',
          )}
        </Modal>
      )}
    </SettingsStack>
  );
}

/** The allowance field: typed freely, saved when the person leaves it or presses Enter, and clamped to 0 to 50. */
function Allowance({
  tiltPercent,
  isDisabled,
  hint,
  onSave,
}: {
  readonly tiltPercent: number;
  readonly isDisabled: boolean;
  readonly hint: string;
  readonly onSave: (next: number, wasClamped: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>();
  const shown = draft ?? String(tiltPercent);
  const commit = () => {
    setDraft(undefined);
    if (draft === undefined) return;
    const typed = Number.parseInt(draft, 10);
    if (Number.isNaN(typed)) return;
    const next = Math.min(TILT_PERCENT_MAX, Math.max(0, typed));
    if (next !== tiltPercent) onSave(next, next !== typed);
  };
  return (
    <Field
      label={strings.allowanceLabel}
      value={shown}
      inputMode="numeric"
      autoComplete="off"
      maxLength={2}
      suffix={strings.percent}
      hint={hint}
      isDisabled={isDisabled}
      onChange={setDraft}
      onSubmit={commit}
      onBlur={commit}
      onEscape={() => setDraft(undefined)}
    />
  );
}

/** Add one fit link: a field, one of its answers, and a skill. Added once all three are picked. */
function AddFitLink({
  fields,
  skills,
  links,
  onAdd,
  onClose,
}: {
  readonly fields: readonly FitField[];
  readonly skills: readonly { readonly id: string; readonly name: string }[];
  readonly links: readonly FitLink[];
  readonly onAdd: (link: FitLink) => void;
  readonly onClose: () => void;
}) {
  const [attributeId, setAttributeId] = useState<string | undefined>(fields[0]?.id);
  const [optionId, setOptionId] = useState<string | undefined>();
  const [skillId, setSkillId] = useState<string | undefined>();
  const field = fields.find((each) => each.id === attributeId);
  const taken =
    attributeId !== undefined &&
    optionId !== undefined &&
    skillId !== undefined &&
    links.some((each) => each.attributeId === attributeId && each.optionId === optionId && each.skillId === skillId);
  const ready = attributeId !== undefined && optionId !== undefined && skillId !== undefined && !taken;
  return (
    <Modal
      title={strings.addLink}
      isOpen
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        <>
          <Button slot="close">{strings.cancel}</Button>
          <Button
            variant="primary"
            isDisabled={!ready}
            onPress={() => {
              if (attributeId === undefined || optionId === undefined || skillId === undefined) return;
              onAdd({ attributeId, optionId, skillId });
              onClose();
            }}
          >
            {strings.addLink}
          </Button>
        </>
      }
    >
      <Select
        label={strings.field}
        placeholder={strings.pickField}
        isSearchable
        items={fields.map((each) => ({ id: each.id, label: each.label }))}
        value={attributeId ?? null}
        onChange={(id) => {
          setAttributeId(id ?? undefined);
          setOptionId(undefined);
        }}
      />
      <Select
        label={strings.option}
        placeholder={strings.pickOption}
        optionStyle="dot"
        isSearchable
        isDisabled={field === undefined}
        items={(field?.attribute.options ?? [])
          .filter((each) => !each.isArchived)
          .map((each) => ({ id: each.id, label: each.label, hue: each.hue }))}
        value={optionId ?? null}
        onChange={(id) => setOptionId(id ?? undefined)}
      />
      <Select
        label={strings.skill}
        placeholder={strings.pickSkill}
        isSearchable
        items={skills.map((each) => ({ id: each.id, label: each.name }))}
        value={skillId ?? null}
        // A trio that already exists leaves Add off: say so, rather than let the dialog look broken.
        {...(taken ? { error: strings.taken } : {})}
        onChange={(id) => setSkillId(id ?? undefined)}
      />
    </Modal>
  );
}
