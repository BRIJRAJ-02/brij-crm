// Brief
// Purpose: the first Hospitality install's one short card (spec 0065, AC-6506): the business and its first place.
// Main task: confirm the name and kind, where it is, its time zone and currency (all prefilled), then Install.
// Leaves out: everything else about the business (Settings › Business), more places, hours and tables.
import type { BusinessKind, FirstBusiness, WorkspaceSettings } from '@crm/data';
import { BUSINESS_KINDS } from '@crm/data/hospitality';
import {
  Button,
  CountryPicker,
  CurrencyPicker,
  Field,
  FormRow,
  Form,
  Modal,
  Select,
  currencyOfCountry,
  type FormRefusal,
} from '@crm/ui';
import { useId, useMemo, useState } from 'react';
import { zoneItems, zoneMatches } from '../booking/hours.ts';
import { formRefusals } from '../settings/refusals.ts';
import { firstBusinessGuess } from './first-business.ts';
import { browserTimeZone } from './starting-zone.ts';
import { strings } from './strings.ts';

/** Props for the business card. */
export interface BusinessCardDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The workspace's own settings: the name, time zone, currency and country the card starts from. */
  readonly workspace: WorkspaceSettings | undefined;
  /** Installs with the card; rejects with the refusal, which lands on its field. */
  readonly onInstall: (business: FirstBusiness) => Promise<void>;
}

const FIELDS = ['name', 'country', 'timeZone', 'currency'] as const;

/** "Your business": a Modal with six short fields, every one prefilled from the workspace. */
export function BusinessCardDialog({ isOpen, onOpenChange, workspace, onInstall }: BusinessCardDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={strings.cardTitle}
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
            {isBusy ? strings.installing : strings.continue}
          </Button>
        </>
      }
    >
      <CardForm
        formId={formId}
        workspace={workspace}
        isBusy={isBusy}
        onBusyChange={setBusy}
        onInstall={onInstall}
        onDone={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}

/** The card's form, mounted afresh with each opening, so it starts from the workspace as it stands. */
function CardForm({
  formId,
  workspace,
  isBusy,
  onBusyChange,
  onInstall,
  onDone,
}: Pick<BusinessCardDialogProps, 'workspace' | 'onInstall'> & {
  readonly formId: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(workspace?.name ?? '');
  const [kind, setKind] = useState<BusinessKind>('restaurant');
  const [addressLine, setAddressLine] = useState('');
  const [city, setCity] = useState('');
  // Sensible defaults so a first install works without reading anything (spec 0068, foolproof; walk of 4 Nov 2026):
  // the workspace's own settings first, else the browser's region, that region's currency and its zone.
  const [guess] = useState(() =>
    firstBusinessGuess(workspace, {
      language: globalThis.navigator.languages[0],
      timeZone: browserTimeZone(),
    }),
  );
  const [country, setCountryValue] = useState<string | null>(guess.country);
  const [timeZone, setTimeZone] = useState(guess.timeZone);
  const [currency, setCurrency] = useState<string | null>(
    guess.currency ?? currencyOfCountry(guess.country ?? undefined) ?? null,
  );
  // The currency follows the country until the person picks one themselves.
  const [currencyPicked, setCurrencyPicked] = useState(false);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  const setCountry = (next: string | null) => {
    setCountryValue(next);
    const follows = currencyOfCountry(next ?? undefined);
    if (!currencyPicked && follows !== undefined) setCurrency(follows);
  };
  const zones = useMemo(() => zoneItems(timeZone, new Date()), [timeZone]);
  const kinds = BUSINESS_KINDS.map((id) => ({ id, label: strings.kinds[id] }));
  const install = () => {
    if (isBusy) return;
    const missing: FormRefusal[] = [
      ...(name.trim() === '' ? [{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }] : []),
      ...(country === null ? [{ code: 'INPUT_INVALID', message: strings.countryMissing, attributeId: 'country' }] : []),
      ...(currency === null
        ? [{ code: 'INPUT_INVALID', message: strings.currencyMissing, attributeId: 'currency' }]
        : []),
    ];
    if (missing.length > 0 || country === null || currency === null) {
      setRefusals(missing);
      return;
    }
    onBusyChange(true);
    setRefusals([]);
    onInstall({
      name: name.trim(),
      kind,
      place: {
        country,
        timeZone,
        ...(addressLine.trim() === '' ? {} : { addressLine: addressLine.trim() }),
        ...(city.trim() === '' ? {} : { city: city.trim() }),
      },
      currency,
    }).then(
      () => {
        onBusyChange(false);
        onDone();
      },
      (error: unknown) => {
        onBusyChange(false);
        setRefusals(formRefusals(error, FIELDS));
      },
    );
  };
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.attributeId}
      onSubmit={install}
      label={strings.cardTitle}
      focusesFirstField
    >
      <FormRow>
        <Field
          label={strings.businessName}
          name="name"
          autoComplete="organization"
          isRequired
          maxLength={80}
          value={name}
          onChange={setName}
        />
        <Select
          label={strings.kind}
          items={kinds}
          value={kind}
          onChange={(next) => {
            const picked = BUSINESS_KINDS.find((each) => each === next);
            if (picked !== undefined) setKind(picked);
          }}
        />
      </FormRow>
      <Field
        label={strings.address}
        name="addressLine"
        autoComplete="address-line1"
        maxLength={200}
        value={addressLine}
        onChange={setAddressLine}
      />
      <FormRow>
        <Field
          label={strings.city}
          name="city"
          autoComplete="address-level2"
          maxLength={100}
          value={city}
          onChange={setCity}
        />
        <CountryPicker label={strings.country} list="all" isRequired value={country} onChange={setCountry} />
      </FormRow>
      <FormRow>
        <Select
          label={strings.timeZone}
          items={zones}
          filter={zoneMatches}
          isSearchable
          value={timeZone}
          onChange={(zone) => {
            if (zone !== null) setTimeZone(zone);
          }}
        />
        <CurrencyPicker
          label={strings.currency}
          value={currency}
          onChange={(next) => {
            setCurrencyPicked(true);
            setCurrency(next);
          }}
        />
      </FormRow>
    </Form>
  );
}
