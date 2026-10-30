// Brief
// Purpose: an object's Access tab (spec 0032, AC-846, AC-851, AC-856): who can see and edit its records, one row per
// who, with a plain line saying the result.
// Main task: tick who can edit and who can see; pick which records (all, their own, their team's); add a team; fold
// open Fields to hide or lock fields; Preview as to see the result as someone would. A change that takes access away
// from people says how many, as chips, with Undo.
// Leaves out: the Guest role (not built yet), and per list access.
import {
  isDataError,
  type AccessImpact,
  type DataLayer,
  type FieldRules,
  type MemberView,
  type ObjectAccess,
  type ObjectSummary,
  type RecordScope,
  type RuleSubject,
  type SubjectAccess,
  type TeamView,
} from '@crm/data';
import {
  Badge,
  Button,
  ButtonGroup,
  ButtonLink,
  Callout,
  Checkbox,
  FieldGroup,
  Icon,
  InfoTip,
  Menu,
  MenuItem,
  MenuTrigger,
  Select,
  Skeleton,
  SettingsSection,
  SettingsStack,
  Table,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useMemo, useRef, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { AccessFields } from './AccessFields.tsx';
import { useAccessPreview } from './AccessPreview.tsx';
import { expected, keyOf, roleOf, type Rule } from './access-grid.ts';
import { summarizeAccess } from './access-summary.ts';
import { objectSettingsHref, teamsSettingsHref } from './nav.ts';
import { strings } from './teams-strings.ts';

/** Props for the Access tab: what its route loaded through the data layer. */
export interface AccessTabProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The object's access as the server answered. */
  readonly access: ObjectAccess;
  /** The workspace's teams, for their names and the Add team menu. */
  readonly teams: readonly TeamView[];
  /** The workspace's members, for Preview as. */
  readonly members: readonly MemberView[];
}

/** What the last change took away from people who had it, and the Undo that gives it back. */
interface Less {
  readonly impact: AccessImpact;
  readonly onUndo: () => void;
}

/** One row of the grid. */
type Row =
  | { readonly kind: 'fixed' }
  | { readonly kind: 'subject'; readonly subject: RuleSubject; readonly standing: SubjectAccess };

/** The grid's columns; the Records one explains itself where the object has nothing to share records by. */
const columnsFor = (slug: string, apiSlug: string, hasOwner: boolean): readonly TableColumn[] => [
  { id: 'who', label: strings.who, isRowHeader: true, isInline: true },
  { id: 'see', label: strings.canSee, size: 'fit' },
  { id: 'edit', label: strings.canEdit, size: 'fit' },
  {
    id: 'records',
    label: strings.records,
    ...(hasOwner
      ? {}
      : {
          info: (
            <InfoTip label={strings.records}>
              {strings.needsField}{' '}
              <ButtonLink variant="link" href={objectSettingsHref(slug, { apiSlug }, 'attributes')}>
                {strings.addField}
              </ButtonLink>
            </InfoTip>
          ),
        }),
  },
  { id: 'actions', label: strings.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

const SCOPES: readonly RecordScope[] = ['all', 'own', 'team'];

/** The message a refusal shows, in the server's words when it gave any. */
const messageOf = (error: unknown) => (isDataError(error) ? error.message : strings.ruleFailed);

/** The Access tab: a grid of who can see and edit, a line for the result, and Add team. */
export function AccessTab({ data, toasts, slug, object, access: initial, teams, members }: AccessTabProps) {
  const [access, setAccess] = useState(initial);
  const [less, setLess] = useState<Less | undefined>(undefined);
  const preview = useAccessPreview({ data, toasts, slug, objectId: object.id, teams, members });
  // The latest change sent for each subject: an older answer arriving late never lands over a newer change.
  const sent = useRef(new Map<string, number>());
  // The toast of the last change, so each change replaces the one before it rather than stacking its own Undo.
  const lastToast = useRef<string | undefined>(undefined);
  const teamNames = useMemo(() => new Map(teams.map((team) => [team.id, team.name])), [teams]);
  const owner = access.ownerAttribute;

  const nameOf = (subject: RuleSubject): string =>
    subject.type === 'role' ? strings.roleGroups[subject.role] : (teamNames.get(subject.teamId) ?? '');

  /**
   * Sends one subject's access and shows it at once; the latest answer replaces what is shown and a quiet toast offers
   * Undo (`back`, what the subject had). A refusal reads the object again, so the grid is what the server holds, with
   * its reason. The controls never go disabled meanwhile: a keyboard user's focus stays where it is.
   */
  const persist = (
    subject: RuleSubject,
    rule: Rule | null,
    undo?: { readonly message: string; readonly back: Rule | null },
  ) => {
    const key = keyOf(subject);
    const mine = (sent.current.get(key) ?? 0) + 1;
    sent.current.set(key, mine);
    setAccess((current) => expected(current, subject, rule, teamNames));
    const isLatest = () => sent.current.get(key) === mine;
    data.accessRules.set(slug, object.id, subject, rule).then(
      ({ access: next, impact }) => {
        if (isLatest()) setAccess(next);
        // An Undo (it has none of its own) brings access back, so what was taken away is no longer news.
        if (undo === undefined) {
          setLess(undefined);
          return;
        }
        if (lastToast.current !== undefined) toasts.dismiss(lastToast.current);
        // Taking access from people who had it says how many and what, as chips, with Undo (AC-850); anything
        // else is the quiet toast.
        if (impact.people > 0) {
          setLess({ impact, onUndo: () => persist(subject, undo.back) });
          return;
        }
        setLess(undefined);
        lastToast.current = toasts.toast({
          tone: 'success',
          message: undo.message,
          action: {
            label: strings.undo,
            onAction: () => {
              persist(subject, undo.back);
            },
          },
        });
      },
      (error: unknown) => {
        toasts.toast({ tone: 'danger', message: messageOf(error) });
        if (!isLatest()) return;
        data.accessRules.get(slug, object.id).then(setAccess, () => undefined);
      },
    );
  };

  const removeTeam = (standing: SubjectAccess) => {
    persist(standing.subject, null, {
      message: strings.teamRemoved(nameOf(standing.subject)),
      back: { level: standing.level, records: standing.records, fields: standing.fields },
    });
    // The button that asked went away with the row.
    focusTitle();
  };

  const change = (standing: SubjectAccess, next: Partial<Rule>) => {
    const level = next.level ?? standing.level;
    const records = level === 'none' ? 'all' : (next.records ?? standing.records);
    persist(
      standing.subject,
      { level, records },
      { message: strings.changed, back: { level: standing.level, records: standing.records, fields: standing.fields } },
    );
  };

  /** One subject's field rules set, as picked in the Fields fold; the object's level and records stay as they are. */
  const changeFields = (subjectKey: string, fields: FieldRules) => {
    const standing = access.subjects.find((each) => keyOf(each.subject) === subjectKey);
    if (standing === undefined) return;
    persist(
      standing.subject,
      { level: standing.level, records: standing.records, fields },
      {
        message: strings.fieldsChanged,
        back: { level: standing.level, records: standing.records, fields: standing.fields },
      },
    );
  };

  const addable = teams.filter((team) => !access.subjects.some((each) => keyOf(each.subject) === team.id));
  const rows: readonly Row[] = [
    { kind: 'fixed' },
    ...access.subjects.map((standing): Row => ({ kind: 'subject', subject: standing.subject, standing })),
  ];
  // The line speaks of Members and teams; another role (Guest) gets its own sentence when it joins the list.
  const role = access.subjects.find((each) => roleOf(each.subject) === 'member');
  const summary = summarizeAccess({
    object: object.pluralName,
    role: role ?? { level: 'write', records: 'all', isDefault: true },
    teams: access.subjects.flatMap((each) =>
      each.subject.type === 'team' ? [{ name: nameOf(each.subject), level: each.level, records: each.records }] : [],
    ),
  });

  const cell = (row: Row, column: string) => {
    if (row.kind === 'fixed') {
      switch (column) {
        case 'who':
          return (
            <>
              <Icon name="lock" size="sm" tone="muted" />
              {strings.ownersAndAdmins}
              <InfoTip label={strings.ownersAndAdmins}>{strings.ownersAndAdminsTip}</InfoTip>
            </>
          );
        case 'see':
        case 'edit':
          return (
            <Checkbox
              label={strings.fixedFor(column === 'see' ? strings.canSee : strings.canEdit)}
              isLabelHidden
              isSelected
              isDisabled
            />
          );
        case 'records':
          return strings.scopes.all;
        default:
          return null;
      }
    }
    const { standing } = row;
    const who = nameOf(standing.subject);
    const isTeam = standing.subject.type === 'team';
    switch (column) {
      case 'who':
        return who;
      case 'see':
        // A team in the grid sees by being in it; taking its access away is its X, the one way out.
        return (
          <Checkbox
            label={strings.seeFor(who)}
            isLabelHidden
            isSelected={standing.level !== 'none'}
            isDisabled={isTeam}
            onChange={(isSelected) => {
              change(standing, { level: isSelected ? 'read' : 'none' });
            }}
          />
        );
      case 'edit':
        return (
          <Checkbox
            label={strings.editFor(who)}
            isLabelHidden
            isSelected={standing.level === 'write'}
            onChange={(isSelected) => {
              change(standing, { level: isSelected ? 'write' : 'read' });
            }}
          />
        );
      case 'records':
        // Nothing to scope by without a Member field; nothing to scope when they can't see the object at all.
        if (owner === undefined) return strings.scopes.all;
        return standing.level === 'none' ? null : (
          <Select
            label={strings.recordsFor(who)}
            isLabelHidden
            size="sm"
            savesOnPick
            items={SCOPES.map((scope) => ({
              id: scope,
              label: strings.scopes[scope],
              ...(scope === 'all' ? {} : { description: strings.scopeWhere(owner.title, scope) }),
            }))}
            value={standing.records}
            onChange={(id) => {
              if (id === 'all' || id === 'own' || id === 'team') change(standing, { records: id });
            }}
          />
        );
      default:
        return isTeam ? (
          <Button
            variant="ghost"
            icon="x"
            label={strings.removeRow(who)}
            onPress={() => {
              removeTeam(standing);
            }}
          />
        ) : null;
    }
  };

  return (
    <SettingsStack>
      {preview.banner}
      {/* The result is said as the grid changes, so a screen reader hears what the tick did. */}
      <Callout isAnnounced>{summary}</Callout>
      {less !== undefined && (
        <Callout tone="warning" isAnnounced actions={<Button onPress={less.onUndo}>{strings.undo}</Button>}>
          <FieldGroup label={strings.lessTitle} layout="row">
            <Badge size="chip" text={strings.lessPeople(less.impact.people)} dot="orange" />
            {less.impact.views > 0 && <Badge size="chip" text={strings.lessViews(less.impact.views)} dot="orange" />}
            {less.impact.forms > 0 && <Badge size="chip" text={strings.lessForms(less.impact.forms)} dot="orange" />}
          </FieldGroup>
        </Callout>
      )}
      <SettingsSection title={strings.gridTitle}>
        <Table
          label={strings.gridTitle}
          columns={columnsFor(slug, object.apiSlug, owner !== undefined)}
          rows={rows}
          getRowId={(row) => (row.kind === 'fixed' ? 'fixed' : keyOf(row.subject))}
          renderCell={cell}
          isScrollable
        />
        <ButtonGroup label={strings.gridTitle} layout="row">
          {teams.length === 0 ? (
            <ButtonLink href={teamsSettingsHref(slug)} icon="users-round">
              {strings.makeTeam}
            </ButtonLink>
          ) : (
            addable.length > 0 && (
              <MenuTrigger>
                <Button icon="plus">{strings.addTeam}</Button>
                <Menu
                  label={strings.addTeam}
                  onAction={(key) => {
                    const teamId = String(key);
                    persist(
                      { type: 'team', teamId },
                      { level: 'write', records: 'all' },
                      { message: strings.teamAdded(teamNames.get(teamId) ?? ''), back: null },
                    );
                  }}
                >
                  {addable.map((team) => (
                    <MenuItem key={team.id} id={team.id} icon="users-round">
                      {team.name}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            )
          )}
          {preview.menu}
        </ButtonGroup>
      </SettingsSection>
      <AccessFields
        object={object.pluralName}
        fields={access.fields}
        subjects={access.subjects.map((each) => ({
          key: keyOf(each.subject),
          name: nameOf(each.subject),
          level: each.level,
          fields: each.fields,
        }))}
        onChange={changeFields}
      />
    </SettingsStack>
  );
}

/** The Access tab while it loads: a line where the result goes, then the grid under its heading. */
export function AccessTabPending() {
  return (
    <SettingsStack>
      <Skeleton width="long" />
      <SettingsSection title={strings.gridTitle}>
        <Table
          label={strings.accessLoading}
          columns={columnsFor('', '', true)}
          rows={[]}
          getRowId={() => ''}
          renderCell={() => null}
          isLoading
        />
      </SettingsSection>
    </SettingsStack>
  );
}
