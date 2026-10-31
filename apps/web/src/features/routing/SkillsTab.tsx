// Brief
// Purpose: Routing › Skills (spec 0037, AC-1382): the workspace's skills in groups, and who holds each.
// Main task: add, rename or delete a skill (deleting asks first, and says where a rule still needs it), and give people skills.
// Leaves out: using skills in a rule (the rule's dialog), fit links (Smart, L8), and the Round robin rows' own pickers.
import { isDataError, type DataLayer, type MemberSummary, type RoutingSkill, type SkillGroup } from '@crm/data';
import { SKILL_GROUPS } from '@crm/data/forms';
import { useRoutingSkills } from '@crm/data/react';
import {
  Button,
  Callout,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  RecordChip,
  SectionBar,
  Select,
  SettingsStack,
  Table,
  TruncatedText,
  focusLater,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useMemo, useRef, useState } from 'react';
import { MemberSkillsPicker } from './MemberSkillsPicker.tsx';
import { skillStrings as strings } from './skills-strings.ts';

/** Props for SkillsTab. */
export interface SkillsTabProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly members: readonly MemberSummary[];
  readonly toasts: Toasts;
}

const SKILL_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.name, isRowHeader: true, isInline: true },
  { id: 'group', label: strings.group },
  { id: 'people', label: strings.heldBy, align: 'end', size: 'fit' },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

const PEOPLE_COLUMNS: readonly TableColumn[] = [
  { id: 'member', label: strings.member, isRowHeader: true, isInline: true },
  { id: 'skills', label: strings.skills, size: 'fill' },
];

/** The skill dialog: new (no skill) or renaming one. */
type Editing = { readonly skill?: RoutingSkill } | undefined;

/** Routing › Skills. */
export function SkillsTab({ data, slug, members, toasts }: SkillsTabProps) {
  const held = useMemo(() => data.routing.skills.view(slug), [data, slug]);
  const state = useRoutingSkills(held);
  const [editing, setEditing] = useState<Editing>();
  const [deleting, setDeleting] = useState<RoutingSkill | undefined>();
  const newRef = useRef<HTMLButtonElement>(null);
  if (state.status === 'error') {
    return (
      <EmptyState tone="error" title={strings.loadFailed} onRetry={() => held.reload()}>
        {state.message}
      </EmptyState>
    );
  }
  const view = state.status === 'ready' ? state.value : undefined;
  const skills = view?.skills ?? [];
  const holders = (skillId: string) =>
    (view?.members ?? []).filter((member) => member.skillIds.includes(skillId)).length;
  return (
    <SettingsStack>
      <SectionBar
        title={strings.skills}
        end={
          <Button ref={newRef} icon="plus" onPress={() => setEditing({})}>
            {strings.newSkill}
          </Button>
        }
      />
      <Table
        label={strings.skillsTable}
        columns={SKILL_COLUMNS}
        rows={skills}
        getRowId={(skill) => skill.id}
        isLoading={state.status === 'loading'}
        emptyState={
          <EmptyState
            icon="tag"
            title={strings.noSkills}
            actions={
              <Button variant="secondary" icon="plus" onPress={() => setEditing({})}>
                {strings.newSkill}
              </Button>
            }
          />
        }
        renderCell={(skill, column) => {
          switch (column) {
            case 'name':
              return <TruncatedText>{skill.name}</TruncatedText>;
            case 'group':
              return strings.groups[skill.group];
            case 'people':
              return String(holders(skill.id));
            default:
              return (
                <MenuTrigger>
                  <Button size="sm" variant="ghost" icon="ellipsis" label={strings.more(skill.name)} />
                  <Menu
                    label={strings.more(skill.name)}
                    onAction={(key) => {
                      if (key === 'rename') setEditing({ skill });
                      if (key === 'delete') setDeleting(skill);
                    }}
                  >
                    <MenuItem id="rename" icon="pencil">
                      {strings.rename}
                    </MenuItem>
                    <MenuItem id="delete" icon="trash" isDanger>
                      {strings.delete}
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              );
          }
        }}
      />
      {skills.length > 0 && view !== undefined && (
        <>
          <SectionBar title={strings.people} />
          <Table
            label={strings.peopleTable}
            columns={PEOPLE_COLUMNS}
            rows={members}
            getRowId={(member) => member.id}
            renderCell={(member, column) =>
              column === 'member' ? (
                <RecordChip display={{ type: 'member', id: member.id, name: member.name }} isFlat />
              ) : (
                <MemberSkillsPicker
                  data={data}
                  slug={slug}
                  memberId={member.id}
                  memberName={member.name}
                  view={view}
                  toasts={toasts}
                />
              )
            }
          />
        </>
      )}
      {editing !== undefined && (
        <SkillDialog
          data={data}
          slug={slug}
          {...(editing.skill === undefined ? {} : { skill: editing.skill })}
          onClose={() => {
            setEditing(undefined);
            focusLater(() => newRef.current);
          }}
        />
      )}
      {deleting !== undefined && (
        <DeleteSkill
          data={data}
          slug={slug}
          skill={deleting}
          holders={holders(deleting.id)}
          onClose={(deleted) => {
            setDeleting(undefined);
            if (deleted) toasts.toast({ tone: 'success', message: strings.deleted(deleting.name) });
            focusLater(() => newRef.current);
          }}
        />
      )}
    </SettingsStack>
  );
}

/** New skill, or rename one: its name and group. The list shows the change at once; a refusal stays in the dialog. */
function SkillDialog({
  data,
  slug,
  skill,
  onClose,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly skill?: RoutingSkill;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(skill?.name ?? '');
  const [group, setGroup] = useState<SkillGroup>(skill?.group ?? 'language');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly onName: boolean } | undefined>();
  const save = () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setFailure({ message: 'Give the skill a name.', onName: true });
      return;
    }
    setBusy(true);
    setFailure(undefined);
    const sent =
      skill === undefined
        ? data.routing.skills.create(slug, group, trimmed)
        : data.routing.skills.update(slug, skill.id, { name: trimmed, group });
    sent.then(
      () => {
        setBusy(false);
        onClose();
      },
      (error: unknown) => {
        setBusy(false);
        const refused = isDataError(error) ? error : undefined;
        setFailure({
          message: refused?.message ?? strings.failed,
          onName: refused?.code === 'CONFIG_INVALID',
        });
      },
    );
  };
  return (
    <Modal
      title={skill === undefined ? strings.newSkill : strings.editSkill}
      isOpen
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={busy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={busy} onPress={save}>
            {busy ? strings.saving : skill === undefined ? strings.add : strings.save}
          </Button>
        </>
      }
    >
      <SettingsStack>
        {failure !== undefined && !failure.onName && <Callout tone="danger">{failure.message}</Callout>}
        <Field
          label={strings.name}
          placeholder={strings.namePlaceholder}
          value={name}
          maxLength={40}
          onChange={setName}
          onSubmit={save}
          {...(failure?.onName === true ? { error: failure.message } : {})}
        />
        <Select
          label={strings.group}
          items={SKILL_GROUPS.map((each) => ({ id: each, label: strings.groups[each] }))}
          value={group}
          onChange={(picked) => {
            const found = SKILL_GROUPS.find((each) => each === picked);
            if (found !== undefined) setGroup(found);
          }}
        />
      </SettingsStack>
    </Modal>
  );
}

/**
 * Delete a skill, asked first (an ending action): it says how many hold it. A skill a rule needs is refused with the
 * rule's name, which then takes the dialog's place, with only Close.
 */
function DeleteSkill({
  data,
  slug,
  skill,
  holders,
  onClose,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly skill: RoutingSkill;
  readonly holders: number;
  readonly onClose: (deleted: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<{ readonly message: string; readonly inUse: boolean } | undefined>();
  return (
    <Modal
      title={strings.deleteTitle(skill.name)}
      variant="confirm"
      tone="danger"
      isOpen
      isBusy={busy}
      onOpenChange={(isOpen) => {
        if (!isOpen && !busy) onClose(false);
      }}
      actions={
        refusal?.inUse === true ? (
          <Button slot="close">{strings.close}</Button>
        ) : (
          <>
            <Button slot="close" isDisabled={busy}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              isPending={busy}
              onPress={() => {
                setBusy(true);
                setRefusal(undefined);
                data.routing.skills.remove(slug, skill.id).then(
                  () => {
                    setBusy(false);
                    onClose(true);
                  },
                  (error: unknown) => {
                    setBusy(false);
                    const refused = isDataError(error) ? error : undefined;
                    setRefusal({
                      message: refused?.message ?? strings.failed,
                      inUse: refused?.code === 'SKILL_IN_USE',
                    });
                  },
                );
              }}
            >
              {busy ? strings.deleting : strings.deleteAction}
            </Button>
          </>
        )
      }
    >
      {refusal === undefined ? (
        strings.deleteText(holders)
      ) : (
        <Callout tone="danger" isAnnounced>
          {refusal.message}
        </Callout>
      )}
    </Modal>
  );
}
