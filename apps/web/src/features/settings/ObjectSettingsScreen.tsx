// Brief
// Purpose: one object's settings, standard or custom alike: its Attributes and Configuration tabs.
// Main task: add, edit, move, archive and restore its attributes, and rename, restyle, archive or restore it; Open
// <Plural> goes to its records.
// Leaves out: types with setup and options (spec 0012, milestone 3), and the schema map (#56).
import { isDataError, type AttributeDefinition, type MemberSummary, type ObjectSummary, type Usage } from '@crm/data';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  Skeleton,
  Spinner,
  TabPanel,
  Tabs,
  Table,
  type TableColumn,
  SettingsSection,
  SettingsStack,
} from '@crm/ui';
import { useNavigate, useParams, useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { objectHref } from '../workspace/objects.ts';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings as attributeStrings } from './attribute-strings.ts';
import { useAtLimit } from './AtLimit.tsx';
import { AttributesTab } from './AttributesTab.tsx';
import { ConfigurationTab, useObjectConfiguration } from './ConfigurationTab.tsx';
import { isObjectTab, objectSettingsHref, type ObjectTab } from './nav.ts';
import { settingsCrumbs, SettingsPage } from './SettingsPage.tsx';
import { strings } from './strings.ts';

/** What the Attributes tab loaded: every attribute (archived ones too), the usage and the members. */
export interface AttributesPage {
  readonly attributes: readonly AttributeDefinition[];
  /** The usage, or undefined when it could not be read (the meter stays a skeleton). */
  readonly usage: Usage | undefined;
  readonly members: readonly MemberSummary[];
}

/** Props for an object's settings: what its route loaded through the data layer. */
export interface ObjectSettingsScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** Every object the person can see, archived ones too. */
  readonly objects: readonly ObjectSummary[];
  readonly tab: ObjectTab;
  /** The Attributes tab's reads; undefined on the other tab and while the object is archived. */
  readonly attributesPage: AttributesPage | undefined;
  /**
   * The Configuration tab's live attributes, for the name attribute: `unavailable` when they couldn't be read,
   * undefined on the other tab and while the object is archived.
   */
  readonly nameAttributes: readonly AttributeDefinition[] | 'unavailable' | undefined;
  /** `?attribute=<id>` (AC-231). */
  readonly selectedAttribute: string | undefined;
  readonly onSelectAttribute: (attributeId: string | undefined, replace?: boolean) => void;
}

/** The object's badges beside its title: Standard or Custom, and Archived while it is. */
function ObjectBadges({ object }: { readonly object: ObjectSummary }) {
  return (
    <>
      <Badge text={object.isStandard ? strings.standard : strings.custom} />
      {object.isArchived && <Badge text={strings.archived} />}
    </>
  );
}

/** An object's settings page: its tile, name and badges, then the Attributes and Configuration tabs. */
export function ObjectSettingsScreen({
  slug,
  object,
  objects,
  tab,
  attributesPage,
  nameAttributes,
  selectedAttribute,
  onSelectAttribute,
}: ObjectSettingsScreenProps) {
  const navigate = useNavigate();
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const canManage = useCan('schema.manage');
  const [isRestoring, setRestoring] = useState(false);
  /** The archived note's Restore: the same call as the Archived section's and the Configuration tab's. */
  const restore = () => {
    if (isRestoring) return;
    setRestoring(true);
    data.objects.restore(slug, object.id).then(
      () => {
        setRestoring(false);
        toasts.toast({ tone: 'success', message: strings.restoredToast(object.pluralName) });
      },
      (error: unknown) => {
        setRestoring(false);
        toasts.toast({
          tone: 'danger',
          message: strings.restoreFailed(
            object.pluralName,
            isDataError(error) ? error.message : strings.somethingWrong,
          ),
        });
      },
    );
  };
  const [isCreating, setCreating] = useState(false);
  const [isMoving, setMoving] = useState(false);
  const showsNew = canManage && tab === 'attributes' && attributesPage !== undefined;
  const limit = useAtLimit(attributesPage?.usage?.attributes[object.id]);
  // The Configuration tab's names and look, held here so its SaveBar sits at the view's foot on either tab.
  const configuration = useObjectConfiguration(slug, object);
  return (
    <SettingsPage
      footer={configuration.footer}
      title={object.pluralName}
      crumbs={settingsCrumbs(slug)}
      hasTabs
      icon={object.icon}
      hue={object.hue}
      meta={<ObjectBadges object={object} />}
      {...(showsNew || !object.isArchived
        ? {
            actions: (
              <>
                {/* A move waits for the server (definition writes are never optimistic): say it is under way. */}
                {showsNew && isMoving && <Spinner label={attributeStrings.moving} />}
                {/* A new object opens here: its records are one press away (an archived one has no table). */}
                {!object.isArchived && (
                  <ButtonLink href={objectHref(slug, object)} icon="arrow-right">
                    {strings.openRecords(object.pluralName)}
                  </ButtonLink>
                )}
                {showsNew && limit.reason}
                {showsNew && (
                  <Button variant="primary" icon="plus" {...limit.buttonProps} onPress={() => setCreating(true)}>
                    {attributeStrings.newAttribute}
                  </Button>
                )}
              </>
            ),
          }
        : {})}
    >
      <Tabs
        // The first tab's label on the page's edge, over the attributes table's first column.
        label={strings.objectTabs(object.pluralName)}
        selectedKey={tab}
        onSelectionChange={(next) => {
          if (isObjectTab(next) && next !== tab) void navigate({ href: objectSettingsHref(slug, object, next) });
        }}
        tabs={[
          { id: 'attributes', label: strings.attributesTab },
          { id: 'configuration', label: strings.configurationTab },
        ]}
      >
        <TabPanel id="attributes">
          {tab === 'attributes' &&
            (attributesPage === undefined ? (
              // An archived object's attributes come back with it.
              <SettingsStack>
                <Callout
                  {...(canManage
                    ? {
                        actions: (
                          <Button icon="archive-restore" isPending={isRestoring} onPress={restore}>
                            {isRestoring ? strings.restoring : strings.restore}
                          </Button>
                        ),
                      }
                    : {})}
                >
                  {strings.archivedObjectAttributes(object.pluralName)}
                </Callout>
              </SettingsStack>
            ) : (
              <AttributesTab
                slug={slug}
                object={object}
                objects={objects}
                {...attributesPage}
                selectedId={selectedAttribute}
                onSelect={onSelectAttribute}
                isCreating={isCreating}
                onCreatingChange={setCreating}
                onMovingChange={setMoving}
              />
            ))}
        </TabPanel>
        <TabPanel id="configuration">
          {tab === 'configuration' && (
            <ConfigurationTab slug={slug} object={object} configuration={configuration} attributes={nameAttributes} />
          )}
        </TabPanel>
      </Tabs>
    </SettingsPage>
  );
}

/** The Attributes tab's columns, so its skeleton rows sit where the rows will. */
const COLUMNS: readonly TableColumn[] = [
  { id: 'title', label: attributeStrings.titleColumn, isRowHeader: true, isInline: true },
  { id: 'type', label: strings.typeColumn },
  { id: 'rules', label: strings.rulesColumn, isInline: true },
  { id: 'actions', label: attributeStrings.actionsColumn, isLabelHidden: true, align: 'end' },
];

/**
 * An object's settings while they load (AC-247): the trail, the header's and
 * the tabs' places, and skeleton rows where the tab's body goes, so nothing
 * jumps when the page arrives.
 */
export function ObjectSettingsPending() {
  const { slug = '', tab = 'attributes' } = useParams({ strict: false });
  // The meter's place only for those who get a meter, so nothing moves when the page arrives.
  const canManage = useCan('schema.manage');
  return (
    <SettingsPage title={strings.loading} crumbs={settingsCrumbs(slug)} hasTabs isLoading hasTile>
      <Tabs
        // The first tab's label on the page's edge, over the attributes table's first column.
        label={strings.loading}
        selectedKey={isObjectTab(tab) ? tab : 'attributes'}
        tabs={[
          { id: 'attributes', label: strings.attributesTab, isDisabled: true },
          { id: 'configuration', label: strings.configurationTab, isDisabled: true },
        ]}
      >
        <TabPanel id="attributes">
          <SettingsStack>
            {canManage && <Skeleton width="long" />}
            <Table
              label={strings.loading}
              columns={COLUMNS}
              rows={[]}
              getRowId={() => ''}
              renderCell={() => null}
              isLoading
            />
            {/* The system attributes' card follows, as on the loaded tab. */}
            <Card title={attributeStrings.system} tone="sunken">
              <Table
                label={attributeStrings.system}
                columns={COLUMNS}
                rows={[]}
                getRowId={() => ''}
                renderCell={() => null}
                isLoading
              />
            </Card>
          </SettingsStack>
        </TabPanel>
        <TabPanel id="configuration">
          {/* The tab's sections in their places (its attributes are read for the name attribute's choice), so the
              cards stand where the loaded ones will. */}
          <SettingsStack>
            <SettingsSection title={strings.lookSection}>
              <Card>
                <Skeleton lines={3} />
              </Card>
            </SettingsSection>
            <SettingsSection title={strings.recordNameSection}>
              <Card>
                <Skeleton lines={2} />
              </Card>
            </SettingsSection>
            <SettingsSection title={strings.idsSection}>
              <Card>
                <Skeleton lines={2} />
              </Card>
            </SettingsSection>
          </SettingsStack>
        </TabPanel>
      </Tabs>
    </SettingsPage>
  );
}
