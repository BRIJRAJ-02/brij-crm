// Brief
// Purpose: Settings › Business's businesses (spec 0065 H7, AC-6516, AC-6590): run more than one brand from one workspace.
// Main task: add a business, see which one the screens show and switch to another, and remove an empty one.
// Leaves out: moving places or menus between businesses (not in this build), each business's page (its own screen).
import type { BusinessKind, HospitalityStore, PropertiesView, PropertySummary } from '@crm/data';
import { BUSINESS_KINDS } from '@crm/data/hospitality';
import {
  Button,
  Callout,
  Card,
  CurrencyPicker,
  Field,
  Form,
  Modal,
  Select,
  SettingsRow,
  SettingsSection,
  Table,
  sharedStrings,
  type FormRefusal,
  type TableColumn,
  type Toasts,
} from '@crm/ui';
import { useId, useState } from 'react';
import { formRefusals } from '../settings/refusals.ts';
import { strings } from './strings.ts';

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.businessName, isRowHeader: true, phone: 'title' },
  { id: 'kind', label: strings.kind },
  { id: 'currency', label: strings.currency },
  { id: 'remove', label: strings.removeBusiness, isLabelHidden: true, align: 'end', showsOnHover: true },
];

/** Props for Businesses. */
export interface BusinessesProps {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly toasts: Toasts;
  readonly view: PropertiesView;
  /** The business the screens show; undefined is the first. */
  readonly choice: string | undefined;
  /** The currency a new business starts with: the one shown now. */
  readonly currency: string | undefined;
}

/**
 * The businesses: for an admin with one, a quiet way to add a second; from two, each with its kind and currency,
 * the one shown marked, a row switching to it, and Remove on an empty one (never the first). A member who may not
 * add one sees the list only from two, as the switcher does.
 */
export function Businesses({ store, slug, toasts, view, choice, currency }: BusinessesProps) {
  const [isAdding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PropertySummary | undefined>();
  const shown = choice ?? view.properties[0]?.id;
  const isMany = view.properties.length > 1;
  if (!isMany && !view.canManage) return null;
  const add = view.canManage ? (
    <Button icon="plus" onPress={() => setAdding(true)}>
      {strings.addBusiness}
    </Button>
  ) : undefined;
  return (
    <SettingsSection
      title={strings.businesses}
      {...(isMany ? { description: strings.businessesText } : {})}
      {...(isMany && add !== undefined ? { actions: add } : {})}
    >
      {isMany ? (
        <Table
          label={strings.businesses}
          columns={COLUMNS}
          rows={view.properties}
          getRowId={(property) => property.id}
          layout="even"
          phoneLayout="rows"
          onRowAction={(id) => {
            store.choose(slug, id);
          }}
          renderCell={(property, column) => {
            switch (column) {
              case 'name':
                return property.id === shown
                  ? strings.shownBusiness(property.name ?? strings.businessTitle)
                  : (property.name ?? strings.businessTitle);
              case 'kind':
                return property.kind === undefined ? '' : strings.kinds[property.kind];
              case 'currency':
                return property.currency ?? '';
              default:
                // Only an empty business other than the first can go (AC-6590), so only those offer it.
                return view.canManage && property.holds === 0 && property.id !== view.properties[0]?.id ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="trash"
                    label={strings.removeNamed(property.name ?? strings.businessTitle)}
                    onPress={() => setRemoving(property)}
                  />
                ) : null;
            }
          }}
        />
      ) : (
        <Card>
          <SettingsRow title={strings.moreBusinesses} description={strings.moreBusinessesText}>
            {add}
          </SettingsRow>
        </Card>
      )}
      <AddBusinessDialog
        key={isAdding ? 'open' : 'closed'}
        isOpen={isAdding}
        onOpenChange={setAdding}
        currency={currency}
        onAdd={async (fields) => {
          const id = store.newId();
          const refused = await store.createProperty(slug, { id, ...fields });
          if (refused !== undefined) throw refused;
          store.choose(slug, id);
          toasts.toast({ tone: 'success', message: strings.businessAdded(fields.name) });
        }}
      />
      {removing !== undefined && (
        <RemoveBusinessDialog
          name={removing.name ?? strings.businessTitle}
          holds={removing.holds}
          onClose={() => setRemoving(undefined)}
          onRemove={async () => {
            const refused = await store.removeProperty(slug, removing.id);
            if (refused !== undefined) throw refused;
            toasts.toast({ tone: 'success', message: strings.businessRemoved(removing.name ?? strings.businessTitle) });
            setRemoving(undefined);
          }}
        />
      )}
    </SettingsSection>
  );
}

const ADD_FIELDS = ['name', 'kind', 'currency'] as const;

/** Add business: its name, kind and currency; places, menus and services follow on its own Business page. */
function AddBusinessDialog({
  isOpen,
  onOpenChange,
  currency: firstCurrency,
  onAdd,
}: {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly currency: string | undefined;
  readonly onAdd: (fields: {
    readonly name: string;
    readonly kind: BusinessKind;
    readonly currency: string;
  }) => Promise<void>;
}) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BusinessKind>('restaurant');
  const [currency, setCurrency] = useState<string | null>(firstCurrency ?? null);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const add = () => {
    if (isBusy) return;
    if (name.trim() === '' || currency === null) {
      setRefusals([
        ...(name.trim() === '' ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }] : []),
        ...(currency === null
          ? [{ code: 'INPUT_INVALID', message: strings.currencyMissing, attributeId: 'currency' }]
          : []),
      ]);
      return;
    }
    setBusy(true);
    setRefusals([]);
    onAdd({ name: name.trim(), kind, currency }).then(
      () => {
        setBusy(false);
        onOpenChange(false);
      },
      (error: unknown) => {
        setBusy(false);
        setRefusals(formRefusals(error, ADD_FIELDS));
      },
    );
  };
  return (
    <Modal
      title={strings.newBusiness}
      variant="window"
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && isBusy) return;
        onOpenChange(open);
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
            {strings.addBusiness}
          </Button>
        </>
      }
    >
      <Form
        id={formId}
        isBusy={isBusy}
        refusals={refusals}
        fieldFor={(refusal) => refusal.attributeId}
        onSubmit={add}
        label={strings.newBusiness}
        focusesFirstField
      >
        <Field label={strings.businessName} name="name" isRequired maxLength={80} value={name} onChange={setName} />
        <Select
          label={strings.kind}
          items={BUSINESS_KINDS.map((id) => ({ id, label: strings.kinds[id] }))}
          value={kind}
          onChange={(next) => {
            const picked = BUSINESS_KINDS.find((each) => each === next);
            if (picked !== undefined) setKind(picked);
          }}
        />
        <CurrencyPicker label={strings.currency} hint={strings.currencyHint} value={currency} onChange={setCurrency} />
      </Form>
    </Modal>
  );
}

/** Asks before a business goes (AC-6590): only an empty one can, and the server says why otherwise. */
function RemoveBusinessDialog({
  name,
  holds,
  onClose,
  onRemove,
}: {
  readonly name: string;
  readonly holds: number;
  readonly onClose: () => void;
  readonly onRemove: () => Promise<void>;
}) {
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    onRemove().catch((error: unknown) => {
      setBusy(false);
      setFailure(
        typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
          ? error.message
          : sharedStrings.couldntDoThat,
      );
    });
  };
  return (
    <Modal
      title={strings.removeBusinessTitle(name)}
      variant="confirm"
      tone="danger"
      isOpen
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" icon="trash" isPending={isBusy} isDisabled={holds > 0} onPress={remove}>
            {strings.removeBusiness}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {holds > 0 ? strings.removeBusinessHolds : strings.removeBusinessText}
    </Modal>
  );
}
