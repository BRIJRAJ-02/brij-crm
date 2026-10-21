// Brief
// Purpose: New booking page (spec 0025 experience, AC-678): a centred dialog, "Add a booking page" (the owner's call on 19 October 2026, over the side panel).
// Main task: a title, the address it suggests, the lengths and the schedule it books by, then Continue into the editor.
// Leaves out: everything else a page has (its editor), and Make it private (pages are on or off until a public profile lists them).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { useSchedules } from '@crm/data/react';
import { Button, Callout, ChoiceChips, Field, InfoTip, Modal, Select, SettingsStack } from '@crm/ui';
import { useState } from 'react';
import { browserZone } from './zone.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings } from './strings.ts';

const DURATIONS = [15, 30, 45, 60, 90] as const;
type Duration = (typeof DURATIONS)[number];

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

/** Props for the dialog. */
export interface NewPageDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (page: BookingPageView) => void;
}

/** The dialog: Title, Address, Duration, Hours, then Cancel or Continue. The id is minted once per opening, so a retry makes one page. */
export function NewPageDialog({ data, slug, isOpen, onClose, onCreated }: NewPageDialogProps) {
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState<string | undefined>(undefined);
  const [durations, setDurations] = useState<readonly Duration[]>([30]);
  // `default` follows the member's default schedule (spec 0035); any other id names one of their schedules.
  const [hours, setHours] = useState('default');
  // The member's schedules, held only while the dialog is open: it is mounted, closed, under all of Captures.
  const schedules = useSchedules(isOpen ? data.schedules.view(slug, undefined, browserZone()) : undefined);
  const choices = schedules.status === 'ready' ? schedules.schedules : [];
  const fallback = choices.find((each) => each.isDefault);
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
    setHours('default');
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
          scheduleId: hours === 'default' ? null : hours,
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
  const close = () => {
    if (isBusy) return;
    // Closed is cancelled: it opens empty next time.
    reset();
    onClose();
  };
  return (
    <Modal
      title={strings.addPage}
      isOpen={isOpen}
      // While the server answers, the dialog stays: a refusal has to land on its field.
      onOpenChange={(open) => {
        if (!open) close();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={create}>
            {isBusy ? strings.creating : strings.continue}
          </Button>
        </>
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
        <Select
          label={strings.hours}
          info={
            <InfoTip label={strings.hours} example={strings.tips.schedule.example}>
              {strings.tips.schedule.text}
            </InfoTip>
          }
          items={[
            { id: 'default', label: scheduleStrings.defaultSchedule(fallback?.name) },
            ...choices.flatMap((each) => (each.id === null ? [] : [{ id: each.id, label: each.name }])),
          ]}
          value={hours}
          hint={scheduleStrings.hoursFromSchedule}
          onChange={(id) => {
            if (id !== null) setHours(id);
          }}
        />
      </SettingsStack>
    </Modal>
  );
}
