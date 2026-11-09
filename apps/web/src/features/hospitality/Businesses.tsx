// Brief
// Purpose: Settings › Business's businesses (spec 0065 H7, AC-6516, AC-6590): run more than one brand from one workspace.
// Main task: add a business, see which one the screens show and switch to another, and remove an empty one.
// Leaves out: moving places or menus between businesses (not in this build), each business's page (its own screen).
import type { BusinessKind, HospitalityStore, PropertiesView, PropertySummary } from '@crm/data';
import { BUSINESS_KINDS, HOSPITALITY_LIMITS } from '@crm/data/hospitality';
import {
  Badge,
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
import { useId, useState, type ReactNode } from 'react';
import { formRefusals } from '../settings/refusals.ts';
import { strings } from './strings.ts';

const COLUMNS: readonly TableColumn[] = [
  { id: 'name', label: strings.businessName, isRowHeader: true, isInline: true, phone: 'title' },
  { id: 'kind', label: strings.kind },
  { id: 'currency', label: strings.currency },
  {
    id: 'remove',
    label: strings.removeBusiness,
    isLabelHidden: true,
    align: 'end',
    size: 'fit',
    showsOnHover: true,
  },
];

/** What `useBusinesses` reads. */
export interface BusinessesInput {
  readonly store: HospitalityStore;
  readonly slug: string;
  readonly toasts: Toasts;
  /** The businesses as read: undefined while they load or failed (`onRetry` reads them again). */
  readonly view: PropertiesView | undefined;
  readonly isFailed: boolean;
  /** The business the screens show; undefined is the first. */
  readonly choice: string | undefined;
  /** What a new business starts with: the one shown now's currency and kind. */
  readonly currency: string | undefined;
  readonly kind: BusinessKind | undefined;
  /** Switches the business shown, asking first when the screen has unsaved changes. */
  readonly onChoose: (id: string) => void;
}

/**
 * The businesses as two parts the screen places: `section` (for an admin with one, a quiet way to add a second;
 * from two, each with its kind and currency, the one shown badged, a row switching to it, and Remove on an empty one,
 * never the first) and `dialogs` (Add business and Remove), which the screen keeps mounted in one spot so neither
 * closes under the person when the list moves. A member who may not add one sees the list only from two.
 */
export function useBusinesses(input: BusinessesInput): { readonly section: ReactNode; readonly dialogs: ReactNode } {
  const { store, slug, toasts, view } = input;
  const [isAdding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PropertySummary | undefined>();
  const dialogs = (
    <>
      <AddBusinessDialog
        key={isAdding ? 'open' : 'closed'}
        isOpen={isAdding}
        onOpenChange={setAdding}
        currency={input.currency}
        kind={input.kind}
        onAdd={async (fields) => {
          const id = store.newId();
          const refused = await store.createProperty(slug, { id, ...fields });
          if (refused !== undefined) throw refused;
          input.onChoose(id);
          toasts.toast({ tone: 'success', message: strings.businessAdded(fields.name) });
        }}
      />
      {removing !== undefined && (
        <RemoveBusinessDialog
          name={removing.name ?? strings.businessTitle}
          onClose={() => setRemoving(undefined)}
          onRemove={async () => {
            const name = removing.name ?? strings.businessTitle;
            setRemoving(undefined);
            const refused = await store.removeProperty(slug, removing.id);
            // Gone from the list at once; a refusal brings it back, and says why here, since the dialog has closed.
            toasts.toast(
              refused === undefined
                ? { tone: 'success', message: strings.businessRemoved(name) }
                : { tone: 'danger', message: refused.message },
            );
          }}
        />
      )}
    </>
  );
  if (input.isFailed) {
    return {
      section: (
        <SettingsSection title={strings.businesses}>
          <Card>
            <SettingsRow title={strings.businessesFailed}>
              <Button onPress={() => store.properties(slug).retry()}>{strings.retry}</Button>
            </SettingsRow>
          </Card>
        </SettingsSection>
      ),
      dialogs,
    };
  }
  if (view === undefined) return { section: null, dialogs };
  const shown = input.choice ?? view.properties[0]?.id;
  const isMany = view.properties.length > 1;
  if (!isMany && !view.canManage) return { section: null, dialogs };
  const isFull = view.properties.length >= HOSPITALITY_LIMITS.properties;
  const add = view.canManage ? (
    <Button icon="plus" isDisabled={isFull} onPress={() => setAdding(true)}>
      {strings.addBusiness}
    </Button>
  ) : undefined;
  const section = (
    <SettingsSection
      title={strings.businesses}
      description={isMany ? (isFull ? strings.businessesFull : strings.businessesText) : undefined}
      {...(isMany && add !== undefined ? { actions: add } : {})}
    >
      {isMany ? (
        <Table
          label={strings.businesses}
          columns={COLUMNS}
          rows={view.properties}
          getRowId={(property) => property.id}
          phoneLayout="rows"
          onRowAction={(id) => {
            if (id !== shown) input.onChoose(id);
          }}
          renderCell={(property, column) => {
            switch (column) {
              case 'name':
                return (
                  <>
                    {property.name ?? strings.businessTitle}
                    {property.id === shown && <Badge text={strings.showing} tone="accent" isWhole />}
                  </>
                );
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
    </SettingsSection>
  );
  return { section, dialogs };
}

const ADD_FIELDS = ['name', 'kind', 'currency'] as const;

/** Add business: its name, kind and currency; places, menus and services follow on its own Business page. */
function AddBusinessDialog({
  isOpen,
  onOpenChange,
  currency: firstCurrency,
  kind: firstKind,
  onAdd,
}: {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly currency: string | undefined;
  readonly kind: BusinessKind | undefined;
  readonly onAdd: (fields: {
    readonly name: string;
    readonly kind: BusinessKind;
    readonly currency: string;
  }) => Promise<void>;
}) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<BusinessKind>(firstKind ?? 'restaurant');
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
  onClose,
  onRemove,
}: {
  readonly name: string;
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
          <Button variant="danger-solid" icon="trash" isPending={isBusy} onPress={remove}>
            {strings.removeBusiness}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.removeBusinessText}
    </Modal>
  );
}
