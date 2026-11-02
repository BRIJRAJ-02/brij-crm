// Brief
// Purpose: Routing › Smart (spec 0037, AC-1361 to AC-1364, AC-1374, AC-1354, AC-1370, AC-1386, AC-1389): how the free reps are ordered once the rules have chosen who may host, and what the nightly run learns from.
// Main task: pick the ranking mode, set the fairness allowance and read the bound it gives, join answers to skills as fit links, then set the holdout, the segments, Learn from and each team page's objective.
// Leaves out: the numbers themselves (Insights); the rules (each surface's Routing card).
import {
  isDataError,
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type FitLink,
  type RoutingObjective,
  type RoutingSkill,
  type SmartMode,
} from '@crm/data';
import {
  FIT_LINKS_MAX,
  HOLDOUT_PERCENT_DEFAULT,
  HOLDOUT_PERCENT_MAX,
  OBJECTIVES,
  SEGMENT_ATTRIBUTES_MAX,
  SEGMENT_OPTIONS_MAX,
  SMART_MODE_DEFAULT,
  TILT_PERCENT_DEFAULT,
  TILT_PERCENT_MAX,
} from '@crm/data/forms';
import { useRoutingSettings, useRoutingSkills } from '@crm/data/react';
import {
  AttributeDisplay,
  AttributeEditor,
  Button,
  Callout,
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
import { learnStrings as learn, smartStrings as strings } from './smart-strings.ts';

/**
 * One select or status field a fit link may read (AC-1362): its definition,
 * so an answer draws through the field set's one display for its type, and
 * the label the pickers show, which names its object as well as the field.
 */
export interface FitField {
  readonly id: string;
  readonly label: string;
  readonly attribute: AttributeDefinition;
  /** Which standard object it lives on: a segment field is never People's (spec 0037, AC-1370). */
  readonly objectKey: 'people' | 'companies' | 'deals';
}

/** One live team page, for its learning objective (spec 0037, AC-1354). */
export interface TeamPage {
  readonly id: string;
  readonly title: string;
  /** What it learns toward now; a page that never set one reads as Deals created. */
  readonly objective: RoutingObjective;
}

/** Props for SmartTab. */
export interface SmartTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The select and status fields on People, Companies and Deals the reader can see, each with its live options. */
  readonly fields: readonly FitField[];
  /** The workspace's live team pages, each with the objective it learns toward (AC-1354). */
  readonly pages: readonly TeamPage[];
  /** Takes the person to Routing › Skills, where a fit link's skill is made. */
  readonly onSkills: () => void;
  /** One team page's learning objective changed (AC-1354); the screen sends it through the page's own write. */
  readonly onObjective: (pageId: string, objective: RoutingObjective) => void;
  readonly toasts: Toasts;
}

/** One empty list, so the maps below don't rebuild on every render while the skills load. */
const EMPTY_SKILLS: readonly RoutingSkill[] = [];

/** Learn from, as the field set's one date editor takes it (AC-1386): a plain optional date. */
const LEARN_SINCE_FIELD = {
  id: 'routing-learn-since',
  name: learn.learnSinceLabel,
  type: 'date' as const,
  allowMultiple: false,
  isRequired: false,
  isUnique: false,
  isReadOnly: false,
};

const FIT_COLUMNS: readonly TableColumn[] = [
  { id: 'field', label: strings.field, isRowHeader: true, isInline: true, size: 'fill' },
  { id: 'option', label: strings.option, isInline: true },
  { id: 'skill', label: strings.skill, isInline: true },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit', showsOnHover: true },
];

const OBJECTIVE_COLUMNS: readonly TableColumn[] = [
  // No `fill`, for the reason InsightsTab's Rep column gives: a filling column can collapse in a scrollable table.
  { id: 'page', label: learn.page, isRowHeader: true, isInline: true },
  { id: 'objective', label: learn.objective, isInline: true },
];

/** The rotation window the sentence speaks of: 30 days, the default every rotation starts with. */
const WINDOW_DAYS = 30;

/** Routing › Smart. */
export function SmartTab({ data, slug, fields, pages, onSkills, onObjective, toasts }: SmartTabProps) {
  const held = useMemo(() => data.routing.settings.view(slug), [data, slug]);
  const state = useRoutingSettings(held);
  const skillsHeld = useMemo(() => data.routing.skills.view(slug), [data, slug]);
  const skillsState = useRoutingSkills(skillsHeld);
  const [adding, setAdding] = useState(false);
  /** The Learn from date waiting for its confirm (AC-1445): set only once the person says Start over. */
  const [learnFrom, setLearnFrom] = useState<string | undefined>();
  const [removing, setRemoving] = useState<FitLink | undefined>();
  const addRef = useRef<HTMLButtonElement>(null);
  const skills = skillsState.status === 'ready' ? skillsState.value.skills : EMPTY_SKILLS;
  const wonMeansSet = skillsState.status === 'ready' && skillsState.value.wonMeansSet;
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
  const holdoutPercent = settings?.holdoutPercent ?? HOLDOUT_PERCENT_DEFAULT;
  const segmentIds = settings?.segmentAttributeIds ?? [];
  const learnSince = settings?.learnSince;
  // A segment field is never a person's (AC-1370), and six options is where a cell stops being able to warm.
  const segmentFields = fields.filter(
    (field) =>
      field.objectKey !== 'people' &&
      (field.attribute.options ?? []).filter((option) => !option.isArchived).length <= SEGMENT_OPTIONS_MAX,
  );
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
          <Percent
            label={strings.allowanceLabel}
            value={tiltPercent}
            max={TILT_PERCENT_MAX}
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
      <Card title={learn.holdout} description={learn.holdoutHint} isBusy={isLoading}>
        {isLoading ? (
          <Skeleton shape="field" />
        ) : (
          <Percent
            label={learn.holdoutLabel}
            value={holdoutPercent}
            max={HOLDOUT_PERCENT_MAX}
            hint={holdoutPercent === 0 ? learn.holdoutOff : learn.holdoutOn(holdoutPercent)}
            onSave={(next, wasClamped) => {
              save({ holdoutPercent: next });
              if (wasClamped) toasts.toast({ tone: 'info', message: learn.holdoutClamped(next) });
            }}
          />
        )}
      </Card>
      <Card title={learn.segments} description={learn.segmentsHint} isBusy={isLoading}>
        {isLoading ? (
          <Skeleton shape="field" />
        ) : segmentFields.length === 0 ? (
          <EmptyState icon="tag" title={learn.noSegmentFields}>
            {learn.noSegmentFieldsText}
          </EmptyState>
        ) : (
          <>
            {Array.from({ length: SEGMENT_ATTRIBUTES_MAX }, (_, place) => {
              const chosen = segmentIds[place];
              // The second field is offered only once the first is set: a gap would read as one segment either way.
              const isDisabled = place > 0 && segmentIds[place - 1] === undefined;
              return (
                <Select
                  key={place}
                  label={learn.segmentField(place + 1)}
                  placeholder={learn.segmentPick}
                  isSearchable
                  isDisabled={isDisabled}
                  items={[
                    { id: 'none', label: learn.segmentPick },
                    ...segmentFields
                      .filter((field) => field.id === chosen || !segmentIds.includes(field.id))
                      .map((field) => ({ id: field.id, label: field.label })),
                  ]}
                  value={chosen ?? 'none'}
                  onChange={(id) => {
                    const next = [...segmentIds];
                    if (id === null || id === 'none') next.splice(place);
                    else next[place] = id;
                    save({ segmentAttributeIds: next });
                  }}
                />
              );
            })}
            <Callout tone="info">{learn.segmentsRestart}</Callout>
          </>
        )}
      </Card>
      <Card title={learn.learnSince} description={learn.learnSinceHint} isBusy={isLoading}>
        {isLoading ? (
          <Skeleton shape="field" />
        ) : (
          // One date, through the field set's one date editor (the design system's rule: one editor per type).
          // Clearing it is the editor's own empty value, not a second button: a button in the card's header
          // squeezed this card's description to a sliver at 390, and said what the field already does.
          <>
            <AttributeEditor
              attribute={LEARN_SINCE_FIELD}
              value={learnSince ?? null}
              surface="form"
              onCommit={(value) => {
                // Clearing it goes straight through (it only widens what counts); setting one asks first (AC-1445).
                if (typeof value === 'string' && value !== '') setLearnFrom(value);
                else if (learnSince !== undefined) {
                  save({ learnSince: null });
                  toasts.toast({ tone: 'success', message: learn.learnSinceCleared });
                }
              }}
            />
            <Callout tone="info">
              {learnSince === undefined ? learn.learnSinceUnset : learn.learnSinceSet(learnSince)}
            </Callout>
          </>
        )}
      </Card>
      <Card title={learn.objectives} description={learn.objectivesHint} isBusy={isLoading}>
        <Table
          label={learn.objectiveTable}
          columns={OBJECTIVE_COLUMNS}
          rows={pages}
          getRowId={(page) => page.id}
          isLoading={isLoading}
          isScrollable
          emptyState={
            <EmptyState icon="users" title={learn.noPages}>
              {learn.noPagesText}
            </EmptyState>
          }
          renderCell={(page, column) =>
            column === 'page' ? (
              <TruncatedText>{page.title}</TruncatedText>
            ) : (
              <Select
                label={learn.objectiveOf(page.title)}
                isLabelHidden
                size="sm"
                items={OBJECTIVES.map((each) => ({
                  id: each,
                  label: learn.objectiveNames[each],
                  // Deals won is offered only once Won means is set (AC-1354, AC-1385).
                  // `description` is what a disabled option shows and announces (Select's README); `hint` is not a
                  // SelectItem prop, so the reason was silently dropped.
                  ...(each === 'won' && !wonMeansSet ? { isDisabled: true, description: learn.wonNeedsStage } : {}),
                }))}
                value={page.objective}
                onChange={(id) => {
                  const next = OBJECTIVES.find((each) => each === id);
                  if (next !== undefined && next !== page.objective) onObjective(page.id, next);
                }}
              />
            )
          }
        />
      </Card>
      {learnFrom !== undefined && (
        <Modal
          title={learn.learnSinceTitle}
          isOpen
          onOpenChange={(isOpen) => {
            if (!isOpen) setLearnFrom(undefined);
          }}
          actions={
            <>
              <Button slot="close">{learn.cancel}</Button>
              <Button
                variant="danger"
                onPress={() => {
                  const day = learnFrom;
                  setLearnFrom(undefined);
                  save({ learnSince: day });
                  toasts.toast({ tone: 'success', message: learn.learnSinceStarted(day) });
                }}
              >
                {learn.learnSinceConfirm}
              </Button>
            </>
          }
        >
          {learn.learnSinceText(learnFrom)}
        </Modal>
      )}
      {adding && (
        <AddFitLink
          fields={fields}
          skills={skills}
          links={links}
          onAdd={(link) => save({ fit: [...links, link] })}
          onClose={() => {
            setAdding(false);
            // Noted for /architect: at the 100th link Add is disabled and so unfocusable, and Table takes no ref,
            // so there is no in-card target to fall back to; Table needs a focus target before that case is right.
            focusLater(() => addRef.current);
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
                  focusLater(() => addRef.current);
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

/**
 * A whole percent, typed freely, saved when the person leaves it or presses
 * Enter, and clamped to 0 to `max`. The allowance and the holdout are the same
 * control with different limits and sentences, so they share it.
 */
function Percent({
  label,
  value,
  max,
  isDisabled = false,
  hint,
  onSave,
}: {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly isDisabled?: boolean;
  readonly hint: string;
  readonly onSave: (next: number, wasClamped: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>();
  const shown = draft ?? String(value);
  const commit = () => {
    setDraft(undefined);
    if (draft === undefined) return;
    const typed = Number.parseInt(draft, 10);
    if (Number.isNaN(typed)) return;
    const next = Math.min(max, Math.max(0, typed));
    if (next !== value) onSave(next, next !== typed);
  };
  return (
    <Field
      label={label}
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
