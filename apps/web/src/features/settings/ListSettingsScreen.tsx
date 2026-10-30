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
import { useState } from 'react';
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
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isArchiving, setArchiving] = useState(false);
  const canManage = list.canManage;
  const isChanged = name.trim() !== list.name || icon !== list.icon || hue !== list.hue;

  const save = () => {
    if (isBusy || name.trim() === '') return;
    setBusy(true);
    setProblem(undefined);
    data.lists.update(slug, list.id, { name: name.trim(), icon, hue }).then(
      (saved) => {
        setBusy(false);
        toasts.toast({ tone: 'success', message: listStrings.saved(saved.name) });
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(isDataError(error) ? error.message : listStrings.saveFailed);
      },
    );
  };

  // "Each record once" applies at once, like every switch; a refusal (a record in twice) says why in a Toast.
  const setOnce = (isOnce: boolean) => {
    data.lists.update(slug, list.id, { allowsDuplicates: !isOnce }).catch((error: unknown) => {
      toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : listStrings.saveFailed });
    });
  };

  return (
    <SettingsStack>
      {!canManage && <Callout>{lockSentence(list, members)}</Callout>}
      <SettingsSection title={listStrings.nameColumn}>
        <Card>
          <Field
            label={listStrings.nameColumn}
            value={name}
            onChange={setName}
            maxLength={100}
            isReadOnly={!canManage}
            {...(problem === undefined ? {} : { error: problem })}
          />
          <ObjectIconButton icon={icon} hue={hue} onChange={setIcon} isReadOnly={!canManage} />
          <ObjectHueField hue={hue} onChange={setHue} isReadOnly={!canManage} />
          {canManage && (
            <Button variant="primary" isPending={isBusy} isDisabled={!isChanged} onPress={save}>
              {listStrings.save}
            </Button>
          )}
        </Card>
      </SettingsSection>
      <Card>
        <Switch
          label={listStrings.eachRecordOnce}
          description={listStrings.eachRecordOnceHint}
          isSelected={!list.allowsDuplicates}
          isDisabled={!canManage}
          onChange={setOnce}
        />
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
                {!list.canManage && <Callout>{lockSentence(list, members)}</Callout>}
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
