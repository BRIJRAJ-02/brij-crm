// Brief
// Purpose: one object's settings, standard or custom alike: its Attributes and Configuration tabs.
// Main task: read the object's attributes, and (owners and admins) rename, restyle, archive or restore it.
// Leaves out: adding and editing attributes (spec 0012, milestone 2), and the schema map (#56).
import type { AttributeDefinition, ObjectSummary } from '@crm/data';
import {
  Badge,
  Callout,
  Card,
  EmptyState,
  fieldTypeOf,
  Icon,
  TabPanel,
  Tabs,
  Table,
  typeLabelOf,
  type TableColumn,
  SettingsStack,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { ConfigurationTab } from './ConfigurationTab.tsx';
import { isObjectTab, objectSettingsHref, type ObjectTab } from './nav.ts';
import { settingsCrumbs, SettingsPage } from './SettingsPage.tsx';
import { strings } from './strings.ts';

/** Props for an object's settings: what its route loaded through the data layer. */
export interface ObjectSettingsScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly tab: ObjectTab;
  /** Its live attributes; undefined while the object is archived (they are read again once it is restored). */
  readonly attributes: readonly AttributeDefinition[] | undefined;
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
export function ObjectSettingsScreen({ slug, object, tab, attributes }: ObjectSettingsScreenProps) {
  const navigate = useNavigate();
  return (
    <SettingsPage
      title={object.pluralName}
      crumbs={settingsCrumbs(slug, 'object')}
      icon={object.icon}
      hue={object.hue}
      meta={<ObjectBadges object={object} />}
    >
      <Tabs
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
          {tab === 'attributes' && <AttributesTab object={object} attributes={attributes} />}
        </TabPanel>
        <TabPanel id="configuration">
          {tab === 'configuration' && <ConfigurationTab slug={slug} object={object} />}
        </TabPanel>
      </Tabs>
    </SettingsPage>
  );
}

const COLUMNS: readonly TableColumn[] = [
  { id: 'title', label: strings.titleColumn, isRowHeader: true },
  { id: 'type', label: strings.typeColumn },
  { id: 'rules', label: strings.rulesColumn },
];

/** One attribute's row: its type's icon and its title, the type's label, and its rules as badges. */
function attributeCell(attribute: AttributeDefinition, column: string) {
  switch (column) {
    case 'title':
      return (
        <>
          <Icon name={fieldTypeOf(attribute.type).icon} size="sm" tone="muted" /> {attribute.title}
        </>
      );
    case 'type':
      return typeLabelOf(attribute.type);
    default:
      return (
        <>
          {attribute.isPrimary && <Badge text={strings.primary} />}
          {attribute.isRequired && <Badge text={strings.required} />}
          {attribute.isUnique && <Badge text={strings.unique} />}
        </>
      );
  }
}

/**
 * The Attributes tab, read only in this milestone: the object's attributes by
 * position, then the system ones. Creating and editing them comes with spec
 * 0012's milestone 2.
 */
function AttributesTab({
  object,
  attributes,
}: {
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[] | undefined;
}) {
  if (attributes === undefined) {
    return (
      <SettingsStack>
        <Callout>{strings.archivedObjectAttributes(object.pluralName)}</Callout>
      </SettingsStack>
    );
  }
  const own = attributes.filter((attribute) => !attribute.isSystem);
  const system = attributes.filter((attribute) => attribute.isSystem);
  return (
    <SettingsStack>
      <Table
        label={strings.attributesTab}
        columns={COLUMNS}
        rows={own}
        getRowId={(attribute) => attribute.id}
        renderCell={attributeCell}
        emptyState={<EmptyState title={strings.noAttributes} />}
      />
      <Card title={strings.system} tone="sunken">
        <Table
          label={strings.system}
          columns={COLUMNS}
          rows={system}
          getRowId={(attribute) => attribute.id}
          renderCell={attributeCell}
        />
      </Card>
    </SettingsStack>
  );
}
