// Brief
// Purpose: one role's page (spec 0037, AC-1240, AC-1241): what it can do, and who has it.
// Main task: owners and admins tick a custom role's permissions, set its data access and scheduling reach, and Save
// (asked first when people have it); everyone reads a built in role's.
// Leaves out: object, field and record rules (an object's Access tab), and per person scheduling access (Members).
import {
  isDataError,
  type DataLayer,
  type MemberView,
  type Permission,
  type RoleDefinition,
  type RolesOverview,
} from '@crm/data';
import {
  Avatar,
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  Field,
  InfoTip,
  LockReason,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SaveBar,
  Select,
  SettingsRow,
  SettingsSection,
  SettingsStack,
  sharedStrings,
  Table,
  TabPanel,
  Tabs,
  TruncatedText,
  type SaveBarStatus,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { pageHeading } from '../navigation/focus.ts';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { DeleteRoleDialog } from './DeleteRoleDialog.tsx';
import { MemberConfirm, type MemberQuestion } from './MemberConfirm.tsx';
import { rolesSettingsHref, roleHref } from './nav.ts';
import {
  changesOf,
  draftOf,
  permissionSections,
  reachOf,
  roleTakesAway,
  withReach,
  type Reach,
  type RoleDraft,
} from './roles.ts';
import { strings } from './roles-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for a role's page: what its route loaded through the data layer. */
export interface RoleScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly role: RoleDefinition;
  readonly overview: RolesOverview;
  /** Everyone, for the People tab (the data layer's one cached list). */
  readonly members: readonly MemberView[];
  /** Holders of `access.manage` change custom roles. */
  readonly canManage: boolean;
  /** Holders of `members.manage` change who holds a role (People tab). */
  readonly canChangePeople: boolean;
  /** The reader's own member id: their own role is never theirs to change here. */
  readonly meId: string;
}

const REACHES: readonly Reach[] = ['self', 'team', 'everyone'];

const PEOPLE_COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.name, isRowHeader: true, isInline: true },
  { id: 'role', label: strings.columns.role, size: 'fit' },
];

/** A role's page: Permissions and People tabs, the SaveBar at the foot, the save confirm and Delete. */
export function RoleScreen({
  data,
  toasts,
  slug,
  role,
  overview,
  members,
  canManage,
  canChangePeople,
  meId,
}: RoleScreenProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const isCustom = role.builtIn === undefined;
  const isEditable = isCustom && canManage;
  const [tab, setTab] = useState('permissions');
  const [draft, setDraft] = useState<RoleDraft>(() => draftOf(role));
  const [isSaving, setSaving] = useState<boolean>(false);
  const [justSaved, setJustSaved] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState<MemberQuestion | undefined>(undefined);
  const [isDeleting, setDeleting] = useState(false);
  // A newer version of the role (a save here, another admin's, a live reload) starts a clean draft over from it; a
  // draft with edits of its own stays, and says someone else changed the role meanwhile.
  const [base, setBase] = useState(role);
  const [isOvertaken, setOvertaken] = useState(false);
  if (base.updatedAt !== role.updatedAt || base.id !== role.id) {
    const kept = base.id === role.id && Object.keys(changesOf(role, draft)).length > 0;
    setBase(role);
    setOvertaken(kept);
    if (!kept) setDraft(draftOf(role));
  }
  useEffect(() => data.members.watch(slug), [data, slug]);
  const changes = changesOf(role, draft);
  const isDirty = Object.keys(changes).length > 0;
  const reach = reachOf(draft.permissions);
  const sections = useMemo(() => permissionSections(isCustom), [isCustom]);
  const holders = members.filter((member) =>
    isCustom ? member.customRoleId === role.id : member.customRoleId === undefined && member.role === role.builtIn,
  );
  const reload = () => router.invalidate();

  const has = (name: Permission) => (isEditable ? draft.permissions.includes(name) : role.permissions.includes(name));
  const toggle = (name: Permission, on: boolean) => {
    setFailure(undefined);
    setDraft((was) => ({
      ...was,
      permissions: on ? [...was.permissions, name] : was.permissions.filter((each) => each !== name),
    }));
  };
  const setReach = (which: 'see' | 'manage', value: Reach) => {
    setFailure(undefined);
    setDraft((was) => ({
      ...was,
      permissions: withReach(was.permissions, { ...reachOf(was.permissions), [which]: value }, which),
    }));
  };

  const send = async () => {
    if (role.updatedAt === undefined) return;
    setSaving(true);
    setFailure(undefined);
    try {
      const saved = await data.roles.update(slug, role.id, { ...changes, updatedAt: role.updatedAt });
      setJustSaved(true);
      setOvertaken(false);
      toasts.toast({ tone: 'success', message: strings.saved(saved.role.label) });
      await reload();
    } catch (error) {
      if (isDataError(error) && error.code === 'STALE') {
        await reload();
        toasts.toast({ tone: 'danger', message: strings.stale });
      } else {
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      }
    } finally {
      setSaving(false);
    }
  };

  // A save that changes what people can do asks first, saying how many (AC-1231); a rename alone, or a role nobody
  // has, saves at once.
  const save = () => {
    if (isSaving || !isDirty) return;
    const count = role.holders ?? holders.length;
    const touchesAccess = changes.permissions !== undefined || changes.dataAccess !== undefined;
    if (count === 0 || !touchesAccess) {
      void send();
      return;
    }
    setQuestion({
      title: strings.saveTitle(role.label),
      text: strings.saveText(count),
      action: strings.saveAction,
      tone: 'default',
      run: send,
    });
  };

  const status: SaveBarStatus = isSaving
    ? 'saving'
    : isDirty
      ? failure === undefined
        ? 'unsaved'
        : 'error'
      : justSaved
        ? 'saved'
        : 'hidden';

  const customCount = overview.roles.filter((each) => each.builtIn === undefined).length;
  const isFull = customCount >= 20;
  // Member's page offers to be the default again while a custom role is (AC-1237).
  const resetsDefault = canManage && role.builtIn === 'member' && !role.isDefault;
  const menu = resetsDefault ? (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.rowActions(role.label)} />
      <Menu
        label={strings.rowActions(role.label)}
        onAction={() => {
          data.roles.setDefault(slug, null).then(
            async () => {
              await reload();
              toasts.toast({ tone: 'success', message: strings.defaultSet(role.label) });
            },
            (error: unknown) => {
              toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
            },
          );
        }}
      >
        <MenuItem id="default" icon="star">
          {strings.makeDefault}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  ) : isEditable ? (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.rowActions(role.label)} />
      <Menu
        label={strings.rowActions(role.label)}
        onAction={(key) => {
          if (key === 'duplicate') {
            data.roles.duplicate(slug, role.id).then(
              (made) => {
                toasts.toast({ tone: 'success', message: strings.duplicated(made.label) });
                void navigate({ href: roleHref(slug, made.id) });
              },
              (error: unknown) => {
                toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
              },
            );
          }
          if (key === 'default') {
            data.roles.setDefault(slug, role.id).then(
              async () => {
                await reload();
                toasts.toast({ tone: 'success', message: strings.defaultSet(role.label) });
              },
              (error: unknown) => {
                toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
              },
            );
          }
          if (key === 'delete') setDeleting(true);
        }}
      >
        {/* A copy is of the saved role: with edits on screen, save or discard them first. */}
        <MenuItem id="duplicate" icon="copy" isDisabled={isFull || isDirty}>
          {strings.duplicate}
        </MenuItem>
        {!role.isDefault && (
          <MenuItem id="default" icon="star">
            {strings.makeDefault}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem id="delete" icon="trash" isDanger>
          {strings.delete}
        </MenuItem>
      </Menu>
    </MenuTrigger>
  ) : undefined;

  const permissionRow = (name: Permission, label: string, description: string, isHoldable: boolean) => (
    <SettingsRow
      key={name}
      title={label}
      meta={
        <>
          <InfoTip label={label}>{description}</InfoTip>
          {/* Only built in roles hold it (AC-1240): a lock says so in its tooltip, not a line on every row. */}
          {isCustom && !isHoldable && <LockReason reason={strings.onlyBuiltIn} size="sm" />}
        </>
      }
      control="fit"
    >
      <Checkbox
        label={strings.permissionFor(label, role.label)}
        isLabelHidden
        isSelected={has(name)}
        {...(isEditable && isHoldable ? {} : isEditable ? { isDisabled: true } : { isReadOnly: true })}
        onChange={(on) => {
          toggle(name, on);
        }}
      />
    </SettingsRow>
  );

  const reachSelect = (which: 'see' | 'manage') => {
    const label = which === 'see' ? strings.see : strings.manage;
    return (
      <SettingsRow
        title={label}
        {...(which === 'see' ? { meta: <InfoTip label={label}>{strings.reachInfo}</InfoTip> } : {})}
        control="field"
      >
        <Select
          label={label}
          isLabelHidden
          items={REACHES.map((value) => ({ id: value, label: strings.reach[value] }))}
          value={isEditable ? reach[which] : reachOf(role.permissions)[which]}
          isReadOnly={!isEditable}
          onChange={(chosen) => {
            const value = REACHES.find((each) => each === chosen);
            if (value !== undefined) setReach(which, value);
          }}
        />
      </SettingsRow>
    );
  };

  const permissions = (
    <SettingsStack>
      {isOvertaken && <Callout tone="warning">{strings.overtaken}</Callout>}
      <SettingsSection title={strings.details}>
        <Card>
          {isEditable && (
            <SettingsRow title={strings.name} control="field">
              <Field
                label={strings.name}
                isLabelHidden
                maxLength={40}
                value={draft.name}
                onChange={(name) => {
                  setFailure(undefined);
                  setDraft((was) => ({ ...was, name }));
                }}
              />
            </SettingsRow>
          )}
          {isEditable && (
            <SettingsRow title={strings.description} control="field">
              <Field
                label={strings.description}
                isLabelHidden
                placeholder={strings.descriptionPlaceholder}
                maxLength={200}
                value={draft.description}
                onChange={(description) => {
                  setFailure(undefined);
                  setDraft((was) => ({ ...was, description }));
                }}
              />
            </SettingsRow>
          )}
          <SettingsRow
            title={strings.dataAccess}
            meta={<InfoTip label={strings.dataAccess}>{strings.dataAccessInfo}</InfoTip>}
            control="field"
          >
            <Select
              label={strings.dataAccess}
              isLabelHidden
              items={[
                { id: 'write', label: strings.readWrite },
                { id: 'read', label: strings.readOnly },
              ]}
              value={isEditable ? draft.dataAccess : role.dataAccess}
              isReadOnly={!isEditable}
              onChange={(value) => {
                if (value === null) return;
                setFailure(undefined);
                setDraft((was) => ({ ...was, dataAccess: value === 'read' ? 'read' : 'write' }));
              }}
            />
          </SettingsRow>
        </Card>
      </SettingsSection>
      {sections.map((section) => (
        <SettingsSection key={section.group} title={section.group}>
          <Card>
            {section.group === 'Scheduling' && reachSelect('see')}
            {section.group === 'Scheduling' && reachSelect('manage')}
            {section.rows.map((row) => permissionRow(row.name, row.label, row.description, row.isHoldable))}
          </Card>
        </SettingsSection>
      ))}
    </SettingsStack>
  );

  const people =
    holders.length === 0 ? (
      <EmptyState icon="users" title={strings.nobody} />
    ) : (
      <Table
        label={strings.peopleTab}
        columns={PEOPLE_COLUMNS}
        rows={holders}
        getRowId={(member) => member.id}
        renderCell={(member, column) =>
          column === 'name' ? (
            <>
              <Avatar
                name={member.name}
                id={member.id}
                {...(member.avatarUrl === undefined ? {} : { src: member.avatarUrl })}
                isDecorative
              />
              <TruncatedText>{member.name}</TruncatedText>
            </>
          ) : (
            <PersonRole
              data={data}
              toasts={toasts}
              slug={slug}
              member={member}
              current={role.id}
              overview={overview}
              canChange={canChangePeople && member.role !== 'owner' && member.id !== meId}
              onChanged={reload}
              onAsk={setQuestion}
            />
          )
        }
        isScrollable
      />
    );

  return (
    <SettingsPage
      title={role.label}
      crumbs={[{ id: 'roles', label: strings.back, href: rolesSettingsHref(slug) }]}
      hasTabs
      // Why the page can't change, as a lock in the header (the owner's less-text rule): a built in role, or a reader
      // without `access.manage`.
      {...(menu !== undefined
        ? { actions: menu }
        : !isCustom
          ? { actions: <LockReason reason={strings.builtInLocked} /> }
          : !canManage
            ? { actions: <LockReason reason={sharedStrings.ownersAndAdminsOnly} /> }
            : {})}
      footer={
        isEditable ? (
          <SaveBar
            status={status}
            {...(failure === undefined ? {} : { error: failure })}
            {...(draft.name.trim() === '' && isDirty ? { blockedReason: strings.nameMissing } : {})}
            onSave={save}
            onDiscard={() => {
              setDraft(draftOf(role));
              setFailure(undefined);
            }}
            onFocusAway={() => pageHeading(document)?.focus()}
          />
        ) : undefined
      }
    >
      <Tabs
        label={strings.tabs(role.label)}
        selectedKey={tab}
        onSelectionChange={setTab}
        tabs={[
          { id: 'permissions', label: strings.permissionsTab },
          { id: 'people', label: strings.peopleTab, count: holders.length },
        ]}
      >
        <TabPanel id="permissions">{tab === 'permissions' && permissions}</TabPanel>
        <TabPanel id="people">{tab === 'people' && <SettingsStack>{people}</SettingsStack>}</TabPanel>
      </Tabs>
      {isEditable && <LeaveGuard isDirty={isDirty} />}
      <MemberConfirm
        question={question}
        onClose={() => {
          setQuestion(undefined);
        }}
        onDone={() => {
          setQuestion(undefined);
        }}
      />
      {isEditable && (
        <DeleteRoleDialog
          role={isDeleting ? { ...role, holders: role.holders ?? holders.length } : undefined}
          roles={overview.roles}
          onClose={() => {
            setDeleting(false);
          }}
          onDelete={async (gone, moveTo) => {
            const { moved } = await data.roles.delete(slug, gone.id, moveTo);
            setDeleting(false);
            // The role is gone, and its unsaved edits with it: leaving asks nothing (committed before the move).
            flushSync(() => {
              setDraft(draftOf(role));
            });
            toasts.toast({ tone: 'success', message: strings.deleted(gone.label, moved) });
            await navigate({ href: rolesSettingsHref(slug) });
          }}
        />
      )}
    </SettingsPage>
  );
}

/** One holder's role on the People tab: a Select for holders of `members.manage`, else the role's name. */
function PersonRole({
  data,
  toasts,
  slug,
  member,
  current,
  overview,
  canChange,
  onChanged,
  onAsk,
}: {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly member: MemberView;
  readonly current: string;
  readonly overview: RolesOverview;
  readonly canChange: boolean;
  readonly onChanged: () => Promise<void>;
  /** Asks first when the new role takes access away (the owner rule, 21 October 2026). */
  readonly onAsk: (question: MemberQuestion) => void;
}) {
  const [isBusy, setBusy] = useState(false);
  const label = overview.roles.find((each) => each.id === current)?.label ?? '';
  if (!canChange) return label;
  const items = overview.roles
    .filter((each) => each.builtIn !== 'owner')
    .map((each) => ({
      id: each.id,
      label: each.label,
      ...(each.builtIn === undefined ? { group: strings.custom } : {}),
    }));
  return (
    <Select
      savesOnPick
      label={strings.changeRoleFor(member.name)}
      isLabelHidden
      variant="inline"
      items={items}
      value={current}
      isDisabled={isBusy}
      onChange={(chosen) => {
        if (chosen === null || chosen === current) return;
        const to = overview.roles.find((each) => each.id === chosen)?.label ?? '';
        const change = async () => {
          await data.members.setRole(slug, member.id, chosen);
          await onChanged();
          toasts.toast({ tone: 'success', message: strings.moved(member.name, to) });
        };
        if (roleTakesAway(overview.roles, current, chosen)) {
          onAsk({
            title: strings.moveTitle(member.name, to),
            text: strings.moveText(member.name),
            action: strings.moveAction(to),
            run: change,
          });
          return;
        }
        setBusy(true);
        change().then(
          () => {
            setBusy(false);
          },
          (error: unknown) => {
            setBusy(false);
            toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.somethingWrong });
          },
        );
      }}
    />
  );
}

/** A role's page while it loads: its tabs, then busy cards where Details and the first groups will be. */
export function RolePending() {
  return (
    <SettingsPage title={strings.loading} isLoading hasTabs>
      <Tabs
        label={strings.loading}
        selectedKey="permissions"
        tabs={[
          { id: 'permissions', label: strings.permissionsTab },
          { id: 'people', label: strings.peopleTab },
        ]}
      >
        <TabPanel id="permissions">
          <SettingsStack>
            <SettingsSection title={strings.details}>
              <Card isBusy>
                <SettingsRow title={strings.dataAccess} />
              </Card>
            </SettingsSection>
            <SettingsSection title={strings.scheduling}>
              <Card isBusy>
                <SettingsRow title={strings.see} />
                <SettingsRow title={strings.manage} />
              </Card>
            </SettingsSection>
          </SettingsStack>
        </TabPanel>
        <TabPanel id="people">{null}</TabPanel>
      </Tabs>
    </SettingsPage>
  );
}
