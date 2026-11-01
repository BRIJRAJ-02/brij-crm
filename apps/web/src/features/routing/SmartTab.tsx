// Brief
// Purpose: Routing › Smart (spec 0037, AC-1361 to AC-1364, AC-1374): how the free reps are ordered once the rules have chosen who may host.
// Main task: pick the ranking mode, set the fairness allowance and read the bound it gives, then join answers to skills as fit links.
// Leaves out: the holdout, segment attributes, Learn from and each page's objective (Insights, L9); the rules themselves (each surface's Routing card).
import { isDataError, type DataLayer, type FitLink, type Hue, type SmartMode } from '@crm/data';
import { FIT_LINKS_MAX, SMART_MODE_DEFAULT, TILT_PERCENT_DEFAULT, TILT_PERCENT_MAX } from '@crm/data/forms';
import { useRoutingSettings, useRoutingSkills } from '@crm/data/react';
import {
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

/** One select or status field a fit link may read, with its live options (AC-1362). */
export interface FitField {
  readonly id: string;
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly label: string; readonly hue?: Hue }[];
}

/** Props for SmartTab. */
export interface SmartTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The select and status fields on People, Companies and Deals the reader can see, each with its live options. */
  readonly fields: readonly FitField[];
  readonly toasts: Toasts;
}

const FIT_COLUMNS: readonly TableColumn[] = [
  { id: 'field', label: strings.field, isRowHeader: true, isInline: true },
  { id: 'option', label: strings.option, isInline: true },
  { id: 'skill', label: strings.skill, isInline: true },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** The bound in whole meetings (AC-1364): the slack plus one meeting, with the slack as a share of a full window. */
function boundOf(tiltPercent: number, windowDays: number): number {
  // The pool's mean load isn't known here, so the sentence states the allowance over one meeting a working day,
  // which is the roughest honest reading of the live bound: slack = tilt% × mean, and at least one meeting.
  const mean = Math.max(1, Math.round((windowDays * 5) / 7));
  return Math.max(1, Math.floor(Math.max((tiltPercent / 100) * mean, 1) + 1));
}

/** The rotation window the sentence speaks of: 30 days, the default every rotation starts with. */
const WINDOW_DAYS = 30;

/** Routing › Smart. */
export function SmartTab({ data, slug, fields, toasts }: SmartTabProps) {
  const held = useMemo(() => data.routing.settings.view(slug), [data, slug]);
  const state = useRoutingSettings(held);
  const skillsHeld = useMemo(() => data.routing.skills.view(slug), [data, slug]);
  const skillsState = useRoutingSkills(skillsHeld);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FitLink | undefined>();
  const addRef = useRef<HTMLButtonElement>(null);
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={() => held.reload()}>
        {state.message === '' ? strings.loadFailedText : state.message}
      </EmptyState>
    );
  }
  const settings = state.status === 'ready' ? state.value : undefined;
  const mode: SmartMode = settings?.smartMode ?? SMART_MODE_DEFAULT;
  const tiltPercent = settings?.tiltPercent ?? TILT_PERCENT_DEFAULT;
  const links = settings?.fit ?? [];
  const skills = skillsState.status === 'ready' ? skillsState.value.skills : [];
  const fieldOf = (id: string) => fields.find((field) => field.id === id);
  const optionOf = (link: FitLink) => fieldOf(link.attributeId)?.options.find((each) => each.id === link.optionId);
  const skillOf = (link: FitLink) => skills.find((skill) => skill.id === link.skillId);
  const save = (change: Parameters<typeof data.routing.settings.set>[1]) => {
    data.routing.settings.set(slug, change).catch((error: unknown) => {
      toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failed });
    });
  };
  return (
    <SettingsStack>
      <Card title={strings.mode} description={strings.modeHint}>
        {state.status === 'loading' ? (
          <Skeleton shape="line" />
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
      <Card
        title={strings.allowance}
        description={strings.allowanceHint}
        footerNote={mode === 'off' ? strings.boundOff : strings.bound(boundOf(tiltPercent, WINDOW_DAYS), WINDOW_DAYS)}
      >
        {state.status === 'loading' ? (
          <Skeleton shape="line" />
        ) : (
          <Allowance
            tiltPercent={tiltPercent}
            isDisabled={mode === 'off'}
            onSave={(next) => save({ tiltPercent: next })}
          />
        )}
      </Card>
      <Card
        title={strings.fit}
        description={strings.fitHint}
        actions={
          <Button
            ref={addRef}
            size="sm"
            variant="secondary"
            icon="plus"
            isDisabled={fields.length === 0 || skills.length === 0 || links.length >= FIT_LINKS_MAX}
            onPress={() => setAdding(true)}
          >
            {strings.addLink}
          </Button>
        }
        {...(links.length >= FIT_LINKS_MAX ? { footerNote: strings.limit(FIT_LINKS_MAX) } : {})}
      >
        <Table
          label={strings.fitTable}
          columns={FIT_COLUMNS}
          rows={links}
          getRowId={(link) => `${link.attributeId}:${link.optionId}:${link.skillId}`}
          isLoading={state.status === 'loading'}
          emptyState={
            <EmptyState
              icon="tag"
              title={strings.noFit}
              actions={
                fields.length === 0 || skills.length === 0 ? undefined : (
                  <Button variant="secondary" icon="plus" onPress={() => setAdding(true)}>
                    {strings.addLink}
                  </Button>
                )
              }
            >
              {fields.length === 0 ? strings.noFields : skills.length === 0 ? strings.noSkills : strings.noFitText}
            </EmptyState>
          }
          renderCell={(link, column) => {
            switch (column) {
              case 'field':
                return <TruncatedText>{fieldOf(link.attributeId)?.label ?? ''}</TruncatedText>;
              case 'option':
                return <TruncatedText>{optionOf(link)?.label ?? ''}</TruncatedText>;
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
                  focusLater(() => addRef.current);
                }}
              >
                {strings.remove}
              </Button>
            </>
          }
        >
          {strings.removeText(optionOf(removing)?.label ?? '', skillOf(removing)?.name ?? '')}
        </Modal>
      )}
    </SettingsStack>
  );
}

/** The allowance field: typed freely, saved when the person leaves it or presses Enter, and clamped to 0 to 50. */
function Allowance({
  tiltPercent,
  isDisabled,
  onSave,
}: {
  readonly tiltPercent: number;
  readonly isDisabled: boolean;
  readonly onSave: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>();
  const shown = draft ?? String(tiltPercent);
  const commit = () => {
    setDraft(undefined);
    if (draft === undefined) return;
    const typed = Number.parseInt(draft, 10);
    const next = Number.isNaN(typed) ? tiltPercent : Math.min(TILT_PERCENT_MAX, Math.max(0, typed));
    if (next !== tiltPercent) onSave(next);
  };
  return (
    <Field
      label={strings.allowanceLabel}
      value={shown}
      inputMode="numeric"
      suffix={strings.percent}
      isDisabled={isDisabled}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
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
        items={(field?.options ?? []).map((each) => ({
          id: each.id,
          label: each.label,
          ...(each.hue === undefined ? {} : { hue: each.hue }),
        }))}
        value={optionId ?? null}
        onChange={(id) => setOptionId(id ?? undefined)}
      />
      <Select
        label={strings.skill}
        placeholder={strings.pickSkill}
        isSearchable
        items={skills.map((each) => ({ id: each.id, label: each.name }))}
        value={skillId ?? null}
        onChange={(id) => setSkillId(id ?? undefined)}
      />
    </Modal>
  );
}
