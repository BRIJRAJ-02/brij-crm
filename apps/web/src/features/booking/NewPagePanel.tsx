// Brief
// Purpose: New booking page (spec 0025 experience, AC-678): a side panel, "Add a booking page".
// Main task: a title, the address it suggests, the lengths and the hours, then Continue into the editor.
// Leaves out: everything else a page has (its editor), and Make it private (pages are on or off until a public profile lists them).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { Button, Callout, ChoiceChips, Field, Panel, SegmentedControl, SettingsStack } from '@crm/ui';
import { useState } from 'react';
import { anyTime, browserZone } from './hours.ts';
import { strings } from './strings.ts';

const DURATIONS = [15, 30, 45, 60, 90] as const;
type Duration = (typeof DURATIONS)[number];
type HoursChoice = 'mine' | 'any' | 'custom';

/** A web address part from a title: lowercase, hyphens for anything else. */
function slugOf(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug;
}

/** Props for the panel. */
export interface NewPagePanelProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (page: BookingPageView) => void;
}

/** The panel: Title, Address, Duration, Hours, Continue. The id is minted once per panel, so a retry makes one page. */
export function NewPagePanel({ data, slug, isOpen, onClose, onCreated }: NewPagePanelProps) {
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [durations, setDurations] = useState<readonly Duration[]>([30]);
  const [hours, setHours] = useState<HoursChoice>('mine');
  const [id, setId] = useState(() => data.bookingPages.newId());
  const [isBusy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{
    readonly title?: string;
    readonly address?: string;
    readonly durations?: string;
  }>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const shownAddress = address ?? slugOf(title);
  const reset = () => {
    setTitle('');
    setAddress(undefined);
    setDurations([30]);
    setHours('mine');
    setErrors({});
    setFailure(undefined);
    setId(data.bookingPages.newId());
  };
  const create = () => {
    if (isBusy) return;
    const found = {
      ...(title.trim() === '' ? { title: strings.titleRequired } : {}),
      ...(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(shownAddress) ? {} : { address: strings.addressHint }),
      ...(durations.length === 0 ? { durations: strings.durationRequired } : {}),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(undefined);
    const zone = browserZone();
    data.bookingPages
      .create(slug, {
        id,
        title: title.trim(),
        timeZone: zone,
        settings: {
          slug: shownAddress,
          durations: [...durations],
          hoursMode: hours === 'mine' ? 'mine' : 'own',
          ...(hours === 'any' ? { availability: anyTime(zone) } : {}),
        },
      })
      .then(
        (page) => {
          setBusy(false);
          reset();
          onCreated(page);
        },
        (error: unknown) => {
          setBusy(false);
          const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
          if (field === 'slug' && isDataError(error)) setErrors({ address: error.message });
          else setFailure(isDataError(error) ? error.message : strings.somethingWrong);
        },
      );
  };
  return (
    <Panel
      title={strings.addPage}
      isOpen={isOpen}
      onClose={() => {
        if (!isBusy) onClose();
      }}
      footer={
        <Button variant="primary" isFullWidth isPending={isBusy} onPress={create}>
          {isBusy ? strings.creating : strings.continue}
        </Button>
      }
    >
      <SettingsStack>
        {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
        <Field
          label={strings.title}
          placeholder={strings.titlePlaceholder}
          value={title}
          onChange={setTitle}
          onSubmit={create}
          maxLength={120}
          isRequired
          {...(errors.title === undefined ? {} : { error: errors.title })}
        />
        <Field
          label={strings.address}
          prefix="/b/"
          hint={strings.addressHint}
          value={shownAddress}
          onChange={(value) => setAddress(value.toLowerCase())}
          maxLength={60}
          {...(errors.address === undefined ? {} : { error: errors.address })}
        />
        <ChoiceChips
          label={strings.duration}
          choices={DURATIONS.map((minutes) => ({ id: String(minutes), label: strings.minutesShort(minutes) }))}
          selected={durations.map(String)}
          onChange={(ids) => setDurations(DURATIONS.filter((minutes) => ids.includes(String(minutes))))}
          {...(errors.durations === undefined ? {} : { error: errors.durations })}
        />
        <SegmentedControl
          label={strings.hours}
          segments={[
            { value: 'mine', label: strings.hoursChoice.mine },
            { value: 'any', label: strings.hoursChoice.any },
            { value: 'custom', label: strings.hoursChoice.custom },
          ]}
          value={hours}
          onChange={(value) => {
            if (value === 'mine' || value === 'any' || value === 'custom') setHours(value);
          }}
        />
      </SettingsStack>
    </Panel>
  );
}
