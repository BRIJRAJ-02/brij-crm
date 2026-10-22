// Brief
// Purpose: one object's settings, standard or custom alike: its Attributes and Configuration tabs.
// Main task: add, edit, move, archive and restore its attributes, and rename, restyle, archive or restore it.
// Leaves out: types with setup and options (spec 0012, milestone 3), and the schema map (#56).
import type { AttributeDefinition, MemberSummary, ObjectSummary, Usage } from '@crm/data';
import {
  Badge,
  Button,
  Callout,
  Card,
  Skeleton,
  Spinner,
  TabPanel,
  Tabs,
  Table,
  type TableColumn,
  SettingsStack,
} from '@crm/ui';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { strings as attributeStrings } from './attribute-strings.ts';
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
  selectedAttribute,
  onSelectAttribute,
}: ObjectSettingsScreenProps) {
  const navigate = useNavigate();
  const canManage = useCan('schema.manage');
  const [isCreating, setCreating] = useState(false);
  const [isMoving, setMoving] = useState(false);
  const showsNew = canManage && tab === 'attributes' && attributesPage !== undefined;
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
      {...(showsNew
        ? {
            actions: (
              <>
                {/* A move waits for the server (definition writes are never optimistic): say it is under way. */}
                {isMoving && <Spinner label={attributeStrings.moving} />}
                <Button variant="primary" icon="plus" onPress={() => setCreating(true)}>
                  {attributeStrings.newAttribute}
                </Button>
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
                <Callout>{strings.archivedObjectAttributes(object.pluralName)}</Callout>
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
          {tab === 'configuration' && <ConfigurationTab slug={slug} object={object} configuration={configuration} />}
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
          <SettingsStack>
            <Table
              label={strings.loading}
              columns={COLUMNS}
              rows={[]}
              getRowId={() => ''}
              renderCell={() => null}
              isLoading
            />
          </SettingsStack>
        </TabPanel>
      </Tabs>
    </SettingsPage>
  );
}
