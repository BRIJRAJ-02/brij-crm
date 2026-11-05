// Brief
// Purpose: one list's settings (spec 0048, AC-4829 to AC-4831): General (name, look, Each record once, archive) and Fields.
// Main task: rename or restyle the list, turn Each record once on or off, archive it, and manage its fields.
// Leaves out: entries (the list's page) and who sees it (a list follows its object, so Access is the object's).
import {
  isDataError,
  type AttributeDefinition,
  type DataLayer,
  type Hue,
  type ListView,
  type MemberSummary,
  type ObjectIcon,
  type ObjectSummary,
} from '@crm/data';
import {
  Button,
  ButtonLink,
  Callout,
  Card,
  Field,
  LockReason,
  SettingsSection,
  SettingsStack,
  Skeleton,
  Switch,
  TabPanel,
  Tabs,
  type Toasts,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { ArchiveListDialog } from '../lists/ArchiveListDialog.tsx';
import { listHref } from '../lists/paths.ts';
import { strings as listStrings } from '../lists/strings.ts';
import { AttributesTab } from './AttributesTab.tsx';
import { isListTab, type ListTab } from './list-tabs.ts';
import { listSettingsHref, listsSettingsHref } from './nav.ts';
import { ObjectHueField, ObjectIconButton } from './ObjectLookFields.tsx';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for a list's settings: what its route loaded through the data layer. */
export interface ListSettingsScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly list: ListView;
  readonly object: ObjectSummary;
  readonly objects: readonly ObjectSummary[];
  readonly tab: ListTab;
  readonly members: readonly MemberSummary[];
  /** The list's fields with the archived ones (the Fields tab); undefined on the other tab. */
  readonly fields: readonly AttributeDefinition[] | undefined;
  /** `?attribute=<id>`: the field whose dialog is open. */
  readonly selectedField: string | undefined;
  readonly onSelectField: (attributeId: string | undefined, replace?: boolean) => void;
}

/** The sentence a non-manager reads (AC-4829), by the maker's name when they are still a member. */
function lockSentence(list: ListView, members: readonly MemberSummary[]) {
  return listStrings.onlyManagers(members.find((member) => member.id === list.createdByMemberId)?.name);
}

/** The General tab: name, icon and hue, Each record once, and Archive list. */
function GeneralTab({
  data,
  toasts,
  slug,
  list,
  members,
}: Pick<ListSettingsScreenProps, 'data' | 'toasts' | 'slug' | 'list' | 'members'>) {
  const navigate = useNavigate();
  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState<ObjectIcon>(list.icon);
  const [hue, setHue] = useState<Hue>(list.hue);
  const [isBusy, setBusy] = useState(false);
  const sent = useRef({ name: list.name, icon: list.icon, hue: list.hue });
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isArchiving, setArchiving] = useState(false);
  const canManage = list.canManage;
  // One save model (critic A #8, 5 November 2026): the name saves when the field is left or Enter is pressed, the
  // icon and colour as they are picked, each with its toast; no Save button in the card.
  const commit = (next: { readonly name?: string; readonly icon?: ObjectIcon; readonly hue?: Hue }) => {
    const nextName = (next.name ?? name).trim();
    if (nextName === '') {
      setName(list.name);
      return;
    }
    const nextIcon = next.icon ?? icon;
    const nextHue = next.hue ?? hue;
    // Against what was last sent, not the list as last read: Enter then leaving the field, or two quick picks, send
    // each change once.
    const was = sent.current;
    if (nextName === was.name && nextIcon === was.icon && nextHue === was.hue) return;
    sent.current = { name: nextName, icon: nextIcon, hue: nextHue };
    setBusy(true);
    setProblem(undefined);
    data.lists.update(slug, list.id, { name: nextName, icon: nextIcon, hue: nextHue }).then(
      (saved) => {
        setBusy(false);
        toasts.toast({ tone: 'success', message: listStrings.saved(saved.name) });
      },
      (error: unknown) => {
        setBusy(false);
        sent.current = was;
        setProblem(isDataError(error) ? error.message : listStrings.saveFailed);
      },
    );
  };

  // "Each record once" applies at once, like every switch; a refusal (records in twice, AC-4830) stays under the
  // switch, saying how many and what to do, until the next change.
  const [onceProblem, setOnceProblem] = useState<string | undefined>(undefined);
  const setOnce = (isOnce: boolean) => {
    setOnceProblem(undefined);
    data.lists.update(slug, list.id, { allowsDuplicates: !isOnce }).catch((error: unknown) => {
      setOnceProblem(isDataError(error) ? error.message : listStrings.saveFailed);
    });
  };

  return (
    <SettingsStack>
      {!canManage && <Callout tone="info">{lockSentence(list, members)}</Callout>}
      <SettingsSection title={listStrings.nameColumn}>
        <Card isBusy={isBusy}>
          <Field
            label={listStrings.nameColumn}
            value={name}
            onChange={setName}
            onBlur={() => {
              commit({ name });
            }}
            onSubmit={() => {
              commit({ name });
            }}
            maxLength={100}
            isReadOnly={!canManage}
            {...(problem === undefined ? {} : { error: problem })}
          />
          <ObjectIconButton
            icon={icon}
            hue={hue}
            onChange={(next) => {
              setIcon(next);
              commit({ icon: next });
            }}
            isReadOnly={!canManage}
          />
          <ObjectHueField
            hue={hue}
            onChange={(next) => {
              setHue(next);
              commit({ hue: next });
            }}
            isReadOnly={!canManage}
          />
        </Card>
      </SettingsSection>
      <Card>
        <Switch
          label={listStrings.eachRecordOnce}
          isSelected={!list.allowsDuplicates}
          isDisabled={!canManage}
          onChange={setOnce}
        />
        {onceProblem !== undefined && (
          <Callout tone="danger" isAnnounced>
            {onceProblem}
          </Callout>
        )}
        {!canManage && <LockReason reason={lockSentence(list, members)} />}
      </Card>
      {canManage && (
        <Card>
          <Button
            variant="danger"
            icon="archive"
            onPress={() => {
              setArchiving(true);
            }}
          >
            {listStrings.archive}
          </Button>
        </Card>
      )}
      <ArchiveListDialog
        data={data}
        slug={slug}
        list={isArchiving ? list : undefined}
        onClose={() => {
          setArchiving(false);
        }}
        onArchived={(archived) => {
          setArchiving(false);
          toasts.toast({ tone: 'success', message: listStrings.archivedToast(archived.name) });
          void navigate({ href: listsSettingsHref(slug) });
        }}
      />
    </SettingsStack>
  );
}

/** A list's settings page: its tile and name, then the General and Fields tabs. */
export function ListSettingsScreen(props: ListSettingsScreenProps) {
  const { slug, list, object, objects, tab, members, fields, selectedField, onSelectField } = props;
  const navigate = useNavigate();
  const [isCreating, setCreating] = useState(false);
  const [, setMoving] = useState(false);
  return (
    <SettingsPage
      title={list.name}
      crumbs={[{ id: 'lists', label: listStrings.settingsTitle, href: listsSettingsHref(slug) }]}
      hasTabs
      icon={list.icon}
      hue={list.hue}
      actions={
        <>
          {!list.isArchived && (
            <ButtonLink href={listHref(slug, list)} icon="arrow-right">
              {listStrings.openList}
            </ButtonLink>
          )}
          {tab === 'fields' && list.canManage && !list.isArchived && (
            <Button
              variant="primary"
              icon="plus"
              onPress={() => {
                setCreating(true);
              }}
            >
              {listStrings.addField}
            </Button>
          )}
        </>
      }
    >
      <Tabs
        label={listStrings.settingsTabs(list.name)}
        selectedKey={tab}
        onSelectionChange={(next) => {
          if (typeof next === 'string' && isListTab(next) && next !== tab) {
            void navigate({ href: listSettingsHref(slug, list, next) });
          }
        }}
        tabs={[
          { id: 'general', label: listStrings.settingsGeneral },
          { id: 'fields', label: listStrings.settingsFields },
        ]}
      >
        <TabPanel id="general">{tab === 'general' && <GeneralTab {...props} />}</TabPanel>
        <TabPanel id="fields">
          {tab === 'fields' &&
            (fields === undefined ? (
              <Skeleton lines={4} />
            ) : (
              <SettingsStack>
                {!list.canManage && <Callout tone="info">{lockSentence(list, members)}</Callout>}
                <AttributesTab
                  slug={slug}
                  object={object}
                  list={list}
                  objects={objects}
                  attributes={fields}
                  usage={undefined}
                  members={members}
                  selectedId={selectedField}
                  onSelect={onSelectField}
                  isCreating={isCreating}
                  onCreatingChange={setCreating}
                  onMovingChange={setMoving}
                />
              </SettingsStack>
            ))}
        </TabPanel>
      </Tabs>
    </SettingsPage>
  );
}
