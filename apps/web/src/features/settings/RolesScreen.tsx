// Brief
// Purpose: Settings › Workspace › Roles (spec 0037, AC-1239): every role, built in then custom, and what each can do.
// Main task: owners and admins open a role to change it, make a new one, or copy, default or delete one; everyone
// compares roles side by side.
// Leaves out: who sees which objects (an object's Access tab), and per person scheduling access (Members).
import {
  isDataError,
  PERMISSION_GROUPS,
  PERMISSION_NAMES,
  PERMISSIONS,
  type DataLayer,
  type Permission,
  type PermissionGroup,
  type RoleDefinition,
  type RolesOverview,
} from '@crm/data';
import {
  Badge,
  Button,
  Icon,
  Link,
  LockReason,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SegmentedControl,
  SettingsSection,
  SettingsStack,
  Table,
  TruncatedText,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Fragment, useEffect, useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { DeleteRoleDialog } from './DeleteRoleDialog.tsx';
import { NewRoleDialog } from './NewRoleDialog.tsx';
import { roleHref } from './nav.ts';
import { strings } from './roles-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the Roles page: what its route loaded through the data layer. */
export interface RolesScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly overview: RolesOverview;
  /** Holders of `access.manage` make and change roles; everyone else reads them. */
  readonly canManage: boolean;
}

const LIST_COLUMNS: readonly TableColumn[] = [
  { id: 'role', label: strings.columns.role, isRowHeader: true, isInline: true },
  { id: 'description', label: strings.columns.description, size: 'fill' },
  { id: 'people', label: strings.columns.people, align: 'end', size: 'fit' },
];

const MANAGE_COLUMNS: readonly TableColumn[] = [
  ...LIST_COLUMNS,
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** The most custom roles (AC-1228): New role and Duplicate wait at it. */
const ROLES_MAX = 20;

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.somethingWrong);

/** The Roles page: List (the roles with their people) or Compare (every permission against every role). */
export function RolesScreen({ data, toasts, slug, overview, canManage }: RolesScreenProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const [view, setView] = useState<'list' | 'compare'>('list');
  const [isCreating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RoleDefinition | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  // Another admin's change reads the roles again and the route reloads (the live `members` event).
  useEffect(() => data.members.watch(slug), [data, slug]);
  const reload = () => router.invalidate();
  const custom = overview.roles.filter((role) => role.builtIn === undefined);
  const isFull = custom.length >= ROLES_MAX;

  const open = (role: RoleDefinition) => {
    void navigate({ href: roleHref(slug, role.id) });
  };

  const act = (role: RoleDefinition, work: () => Promise<string>) => {
    if (busy !== undefined) return;
    setBusy(role.id);
    work().then(
      async (said) => {
        await reload();
        setBusy(undefined);
        toasts.toast({ tone: 'success', message: said });
      },
      (error: unknown) => {
        setBusy(undefined);
        toasts.toast({ tone: 'danger', message: messageOf(error) });
      },
    );
  };

  const cell = (role: RoleDefinition, column: string) => {
    switch (column) {
      case 'role':
        return (
          <>
            <Link href={roleHref(slug, role.id)}>{role.label}</Link>
            {role.builtIn !== undefined && <Badge text={strings.builtIn} isWhole />}
            {role.isDefault && <Badge text={strings.default} tone="accent" isWhole />}
          </>
        );
      case 'description':
        return <TruncatedText>{role.description}</TruncatedText>;
      case 'people':
        return role.holders === undefined ? '' : String(role.holders);
      default:
        // Member is the default again from its own row, while a custom role is (AC-1237).
        if (role.builtIn === 'member' && !role.isDefault) {
          return (
            <MenuTrigger>
              <Button
                variant="ghost"
                icon="ellipsis"
                label={strings.rowActions(role.label)}
                isPending={busy === role.id}
              />
              <Menu
                label={strings.rowActions(role.label)}
                onAction={() => {
                  act(role, async () => {
                    await data.roles.setDefault(slug, null);
                    return strings.defaultSet(role.label);
                  });
                }}
              >
                <MenuItem id="default" icon="star">
                  {strings.makeDefault}
                </MenuItem>
              </Menu>
            </MenuTrigger>
          );
        }
        if (role.builtIn !== undefined) return null;
        return (
          <MenuTrigger>
            <Button
              variant="ghost"
              icon="ellipsis"
              label={strings.rowActions(role.label)}
              isPending={busy === role.id}
            />
            <Menu
              label={strings.rowActions(role.label)}
              onAction={(key) => {
                if (key === 'duplicate') {
                  act(role, async () => strings.duplicated((await data.roles.duplicate(slug, role.id)).label));
                }
                if (key === 'default') {
                  act(role, async () => {
                    await data.roles.setDefault(slug, role.id);
                    return strings.defaultSet(role.label);
                  });
                }
                if (key === 'delete') setDeleting(role);
              }}
            >
              <MenuItem id="duplicate" icon="copy" isDisabled={isFull}>
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
        );
    }
  };

  const actions = (
    <>
      <SegmentedControl
        label={strings.views}
        segments={[
          { value: 'list', label: strings.list },
          { value: 'compare', label: strings.compare },
        ]}
        value={view}
        onChange={(next) => {
          setView(next === 'compare' ? 'compare' : 'list');
        }}
      />
      {/* At 20 roles, a lock says why New role waits. */}
      {canManage && isFull && <LockReason reason={strings.atLimit} />}
      {canManage && (
        <Button
          variant="primary"
          icon="plus"
          isDisabled={isFull}
          onPress={() => {
            setCreating(true);
          }}
        >
          {strings.newRole}
        </Button>
      )}
    </>
  );

  return (
    <SettingsPage title={strings.title} actions={actions}>
      {view === 'list' ? (
        <Table
          label={strings.title}
          columns={canManage ? MANAGE_COLUMNS : LIST_COLUMNS}
          rows={overview.roles}
          getRowId={(role) => role.id}
          renderCell={cell}
          onRowAction={(id) => {
            const role = overview.roles.find((each) => each.id === id);
            if (role !== undefined) open(role);
          }}
          isScrollable
        />
      ) : (
        <Compare roles={overview.roles} />
      )}
      {canManage && (
        <NewRoleDialog
          isOpen={isCreating}
          onOpenChange={setCreating}
          roles={overview.roles}
          onCreate={async (role) => {
            const made = await data.roles.create(slug, { id: data.roles.newId(), ...role });
            toasts.toast({ tone: 'success', message: strings.created(made.label) });
            await reload();
            open(made);
          }}
        />
      )}
      {canManage && (
        <DeleteRoleDialog
          role={deleting}
          roles={overview.roles}
          onClose={() => {
            setDeleting(undefined);
          }}
          onDelete={async (role, moveTo) => {
            const { moved } = await data.roles.delete(slug, role.id, moveTo);
            setDeleting(undefined);
            await reload();
            toasts.toast({ tone: 'success', message: strings.deleted(role.label, moved) });
          }}
        />
      )}
    </SettingsPage>
  );
}

/** One row of Compare: a permission, or the data access every role has. */
type CompareRow =
  { readonly id: Permission; readonly kind: 'permission' } | { readonly id: 'data'; readonly kind: 'data' };

/**
 * Compare (AC-1239): every permission (rows, by group, with labels) against every role (columns), read only. One
 * table per group, the first with the roles' names as headers and the others continuing it without repeating them.
 */
function Compare({ roles }: { readonly roles: readonly RoleDefinition[] }) {
  const columns: readonly TableColumn[] = [
    { id: 'permission', label: strings.permission, isRowHeader: true, size: 'fill' },
    ...roles.map((role) => ({ id: role.id, label: role.label, align: 'end' as const, size: 'fit' as const })),
  ];
  const groups: readonly { readonly group: PermissionGroup | 'data'; readonly rows: readonly CompareRow[] }[] = [
    { group: 'data', rows: [{ id: 'data', kind: 'data' }] },
    ...PERMISSION_GROUPS.map((group) => ({
      group,
      rows: PERMISSION_NAMES.filter((name) => PERMISSIONS[name].group === group).map((name): CompareRow => ({
        id: name,
        kind: 'permission',
      })),
    })),
  ];
  const cell = (row: CompareRow, column: string) => {
    if (column === 'permission') {
      return row.kind === 'data' ? strings.dataAccessRow : PERMISSIONS[row.id].label;
    }
    const role = roles.find((each) => each.id === column);
    if (role === undefined) return null;
    if (row.kind === 'data') return role.dataAccess === 'write' ? strings.readWrite : strings.readOnly;
    const label = PERMISSIONS[row.id].label;
    return role.permissions.includes(row.id) ? (
      <Icon name="check" tone="success" label={strings.holds(role.label, label)} />
    ) : (
      <Icon name="minus" tone="muted" label={strings.holdsNot(role.label, label)} />
    );
  };
  return (
    <SettingsStack>
      {groups.map(({ group, rows }, index) => {
        const table = (
          <Table
            label={group === 'data' ? strings.compareLabel : `${strings.compareLabel}: ${group}`}
            columns={columns}
            rows={rows}
            getRowId={(row) => row.id}
            renderCell={cell}
            isHeaderHidden={index > 0}
            isScrollable
          />
        );
        return group === 'data' ? (
          <Fragment key={group}>{table}</Fragment>
        ) : (
          <SettingsSection key={group} title={group}>
            {table}
          </SettingsSection>
        );
      })}
    </SettingsStack>
  );
}

/** The Roles page while it loads. */
export function RolesPending() {
  const canManage = useCan('access.manage');
  return (
    <SettingsPage title={strings.loading} isLoading>
      <Table
        label={strings.loading}
        columns={canManage ? MANAGE_COLUMNS : LIST_COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}
