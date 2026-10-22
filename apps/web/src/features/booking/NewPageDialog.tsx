// Brief
// Purpose: New booking page (spec 0025 experience, AC-678): a centred dialog, "Add a booking page" (the owner's call on 19 October 2026, over the side panel).
// Main task: a title, one length and the schedule it books by, then Create page into the editor.
// An admin also chooses who it books: themselves, or one host from a rotation (spec 0029, AC-732); a round robin page's other hosts are set in its editor.
// Leaves out: everything else a page has (its editor), and its web address part: the server makes a free one from the title (22 October 2026: it shows nowhere a visitor sees, since links use the page's key).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { useCaptureList, useSchedules } from '@crm/data/react';
import { Button, Callout, Field, InfoTip, Link, Modal, Radio, RadioGroup, SegmentedControl, Select } from '@crm/ui';
import { useState } from 'react';
import { rotationsSettingsHref } from '../settings/nav.ts';
import { strings as rotationStrings } from './rotation-strings.ts';
import { lengthOf } from './durations.ts';
import { browserZone } from './zone.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { scheduleChoices } from './schedules.ts';
import { strings } from './strings.ts';

/** The lengths offered as segments; any other the server allows goes through Custom. */
const SEGMENTS = [15, 30, 45, 60] as const;
const CUSTOM = 'custom';

/** Props for the dialog. */
export interface NewPageDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The reader may book a rotation's hosts (booking.admin): the dialog offers who it books. */
  readonly canBookTeams?: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onCreated: (page: BookingPageView) => void;
  /** Makes it Link only from the start (Bookings' "Create a link only page", for reserved time). */
  readonly isLinkOnly?: boolean;
}

/** The dialog: Title, Duration, Schedule, then Cancel or Create page. The id is minted once per opening, so a retry makes one page. */
export function NewPageDialog({
  data,
  slug,
  canBookTeams = false,
  isOpen,
  onClose,
  onCreated,
  isLinkOnly = false,
}: NewPageDialogProps) {
  const [title, setTitle] = useState('');
  // A segment's minutes, or `custom` with the typed minutes beside it.
  const [length, setLength] = useState('30');
  const [custom, setCustom] = useState('');
  // `default` follows the member's default schedule (spec 0035); any other id names one of their schedules.
  const [schedule, setSchedule] = useState('default');
  // The member's schedules, held only while the dialog is open: it is mounted, closed, under all of Captures.
  const schedules = useSchedules(isOpen ? data.schedules.view(slug, undefined, browserZone()) : undefined);
  const choices = schedules.status === 'ready' ? schedules.schedules : [];
  const [who, setWho] = useState<'me' | 'rotation'>('me');
  const [rotationId, setRotationId] = useState<string | null>(null);
  const [rotationError, setRotationError] = useState<string | undefined>(undefined);
  const rotations = useCaptureList(data.rotations.view(slug));
  const rotationItems =
    rotations.status === 'ready'
      ? rotations.items.map((each) => ({
          id: each.id,
          label: each.name,
          description: rotationStrings.summary(each.strategy, each.windowDays, each.pages),
        }))
      : [];
  const isTeam = canBookTeams && who === 'rotation';
  const [id, setId] = useState(() => data.bookingPages.newId());
  const [isBusy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ readonly title?: string; readonly custom?: string }>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const reset = () => {
    setTitle('');
    setLength('30');
    setCustom('');
    setSchedule('default');
    setWho('me');
    setRotationId(null);
    setRotationError(undefined);
    setErrors({});
    setFailure(undefined);
    setId(data.bookingPages.newId());
  };
  const create = () => {
    if (isBusy) return;
    const minutes = length === CUSTOM ? lengthOf(custom) : lengthOf(length);
    const found = {
      ...(title.trim() === '' ? { title: strings.titleRequired } : {}),
      ...(minutes === undefined ? { custom: strings.customMinutesInvalid } : {}),
    };
    setErrors(found);
    const missingRotation = isTeam && rotationId === null;
    setRotationError(missingRotation ? rotationStrings.rotationRequired : undefined);
    if (minutes === undefined || Object.keys(found).length > 0 || missingRotation) return;
    setBusy(true);
    setFailure(undefined);
    data.bookingPages
      .create(slug, {
        id,
        title: title.trim(),
        timeZone: browserZone(),
        // A round robin page books by each host's own hours, so it names no schedule.
        settings: {
          ...(isTeam
            ? { durations: [minutes] }
            : { durations: [minutes], scheduleId: schedule === 'default' ? null : schedule }),
          ...(isLinkOnly ? { isPrivate: true } : {}),
        },
        ...(isTeam && rotationId !== null
          ? { kind: 'round_robin' as const, hosts: { fixed: [], rotations: [rotationId] } }
          : {}),
      })
      .then(
        (page) => {
          setBusy(false);
          reset();
          onCreated(page);
        },
        (error: unknown) => {
          setBusy(false);
          // A refusal on a field the dialog shows lands on it; anything else goes above the form.
          const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
          if (isDataError(error) && field === 'title') setErrors({ title: error.message });
          else if (isDataError(error) && field === 'durations' && length === CUSTOM)
            setErrors({ custom: error.message });
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
      title={isLinkOnly ? strings.addLinkOnlyPage : strings.addPage}
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
            {isBusy ? strings.creating : strings.createPage}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        label={strings.title}
        placeholder={strings.titlePlaceholder}
        value={title}
        onChange={(value) => {
          setTitle(value);
          setErrors(({ title: _, ...rest }) => rest);
        }}
        onSubmit={create}
        maxLength={120}
        isRequired
        isDisabled={isBusy}
        // The dialog opens to name the page: its first field is what the press asked for.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        {...(errors.title === undefined ? {} : { error: errors.title })}
      />
      <SegmentedControl
        label={strings.duration}
        size="compact"
        isLabelVisible
        isDisabled={isBusy}
        segments={[
          ...SEGMENTS.map((minutes) => ({ value: String(minutes), label: strings.minutesShort(minutes) })),
          { value: CUSTOM, label: strings.durationCustom },
        ]}
        value={length}
        onChange={(value) => {
          setLength(value);
          setErrors(({ custom: _, ...rest }) => rest);
        }}
      />
      {length === CUSTOM && (
        <Field
          label={strings.customMinutes}
          inputMode="numeric"
          hint={strings.customMinutesHint}
          suffix={strings.minutesUnit}
          value={custom}
          onChange={(value) => {
            setCustom(value);
            setErrors(({ custom: _, ...rest }) => rest);
          }}
          onSubmit={create}
          maxLength={3}
          isRequired
          isDisabled={isBusy}
          {...(errors.custom === undefined ? {} : { error: errors.custom })}
        />
      )}
      {canBookTeams && (
        <RadioGroup
          label={rotationStrings.whoBooks}
          value={who}
          isDisabled={isBusy}
          onChange={(value) => {
            if (value === 'me' || value === 'rotation') setWho(value);
          }}
        >
          <Radio value="me">{rotationStrings.bookMe}</Radio>
          <Radio value="rotation">{rotationStrings.bookRotation}</Radio>
        </RadioGroup>
      )}
      {isTeam &&
        (rotationItems.length === 0 && rotations.status === 'ready' ? (
          <Callout
            tone="info"
            actions={<Link href={rotationsSettingsHref(slug)}>{rotationStrings.manageRotations}</Link>}
          >
            {rotationStrings.noRotations}
          </Callout>
        ) : (
          <Select
            label={rotationStrings.rotation}
            placeholder={rotationStrings.pickRotation}
            items={rotationItems}
            value={rotationId}
            onChange={setRotationId}
            isRequired
            isDisabled={isBusy}
            {...(rotationError === undefined ? {} : { error: rotationError })}
          />
        ))}
      {!isTeam && (
        <Select
          label={scheduleStrings.schedule}
          info={<InfoTip label={scheduleStrings.schedule}>{strings.tips.schedule.text}</InfoTip>}
          items={scheduleChoices(choices, schedule === 'default' ? null : schedule)}
          value={schedule}
          isDisabled={isBusy}
          onChange={(id) => {
            if (id !== null) setSchedule(id);
          }}
        />
      )}
    </Modal>
  );
}
