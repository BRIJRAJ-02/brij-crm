// Brief
// Purpose: New booking page (spec 0025 experience, AC-678; spec 0058, AC-5 and AC-17): a centred dialog, "Add a booking page", then its Ready panel.
// Main task: a title and one length, then Create page; the Ready panel shows the link (Copy, Share, QR, a small preview), and Edit page opens the editor.
// An admin also chooses who it books: themselves, one host from a rotation (spec 0029, AC-732), or everyone on the roster, which makes a workspace link (30 Oct 2026).
// Leaves out: the schedule (the page follows the default; another is picked on the editor's Hours tab, as Calendly and Cal.com do), everything else a page has (its editor), and its web address part (the server makes one from the title).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  Callout,
  Field,
  Link,
  Modal,
  PreviewFrame,
  Radio,
  RadioGroup,
  ReadyPanel,
  SegmentedControl,
  Select,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings as rotationStrings } from './rotation-strings.ts';
import { lengthOf } from './durations.ts';
import { memberZone } from './zone.ts';
import { strings } from './strings.ts';
import { publicBookingUrl, roundRobinHref } from './links.ts';

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
  /** The page exists and its Ready panel was dismissed (Edit page, Esc or close): the caller opens its editor. */
  readonly onCreated: (page: BookingPageView) => void;
  /** Makes it Link only from the start (Bookings' "Create a link only page", for reserved time). */
  readonly isLinkOnly?: boolean;
}

/**
 * The dialog: Title and Duration, then Cancel or Create page; once made, the Ready panel in the same Modal. The page
 * follows the default schedule. The id is minted once per opening, so a retry makes one page.
 */
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
  // The page just made: the dialog turns to its Ready panel until it is dismissed (spec 0058, AC-5).
  const [created, setCreated] = useState<BookingPageView | undefined>(undefined);
  // `everyone` makes the workspace's own link, booking whoever on the roster is free (team scheduling, decision 3).
  const [who, setWho] = useState<'me' | 'rotation' | 'everyone'>('me');
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
  const isWorkspace = canBookTeams && who === 'everyone' && !isLinkOnly;
  // No group yet: Manage round robin opens in a new tab, so what is typed here stays (flow walks B8), and the
  // groups are read again when this tab is back in front.
  const isWaitingForGroup = isOpen && isTeam && rotations.status === 'ready' && rotationItems.length === 0;
  useEffect(() => {
    if (!isWaitingForGroup) return;
    const reread = () => {
      if (document.visibilityState === 'visible') data.rotations.view(slug).reload();
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => {
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [isWaitingForGroup, data, slug]);
  // The group made there arrives: the only one is picked, and focus goes to the picker that replaced the link.
  const [wasWaiting, setWasWaiting] = useState(false);
  const [focusGroups, setFocusGroups] = useState(false);
  if (isWaitingForGroup !== wasWaiting) {
    setWasWaiting(isWaitingForGroup);
    if (!isWaitingForGroup && isTeam && rotationItems.length > 0) {
      if (rotationItems.length === 1) setRotationId(rotationItems[0]?.id ?? null);
      setFocusGroups(true);
    }
  }
  const [id, setId] = useState(() => data.bookingPages.newId());
  const [isBusy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ readonly title?: string; readonly custom?: string }>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const reset = () => {
    setTitle('');
    setLength('30');
    setCustom('');
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
        timeZone: memberZone(data, slug),
        // A one on one page follows the default schedule (AC-17); a round robin page books by each host's own hours.
        settings: {
          ...(isTeam || isWorkspace ? { durations: [minutes] } : { durations: [minutes], scheduleId: null }),
          ...(isLinkOnly ? { isPrivate: true } : {}),
        },
        ...(isTeam && rotationId !== null
          ? { kind: 'round_robin' as const, hosts: { fixed: [], rotations: [rotationId] } }
          : {}),
        ...(isWorkspace ? { kind: 'round_robin' as const, scope: 'workspace' as const } : {}),
      })
      .then(
        (page) => {
          setBusy(false);
          // The workspace's first link made "Everyone on the roster": the held rotations read it.
          if (isWorkspace) data.rotations.view(slug).reload();
          reset();
          setCreated(page);
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
  if (created !== undefined) {
    // Any way out of the Ready panel goes on to the editor, as Create page always has.
    const finish = () => {
      setCreated(undefined);
      onCreated(created);
    };
    return (
      <Modal
        title={created.title}
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) finish();
        }}
        actions={
          <Button variant="primary" onPress={finish}>
            {strings.readyEdit}
          </Button>
        }
      >
        <ReadyPanel
          title={strings.readyTitle}
          message={strings.readyMessage}
          link={publicBookingUrl(created)}
          shareTitle={created.title}
          previewLabel={strings.readyPreview}
          // The visitor's page itself, small and inert, at the QR code's height (the slot's own frame).
          preview={<PreviewFrame src={`/b/${created.publicKey}`} title={created.title} version={created.updatedAt} />}
        />
      </Modal>
    );
  }
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
          <Button slot="close" isDisabled={isBusy}>
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
          variant="cards"
          value={who}
          isDisabled={isBusy}
          onChange={(value) => {
            if (value === 'me' || value === 'rotation' || value === 'everyone') setWho(value);
          }}
        >
          <Radio value="me" icon="user" description={rotationStrings.bookMeLine}>
            {rotationStrings.bookMe}
          </Radio>
          <Radio value="rotation" icon="users" description={rotationStrings.bookRotationLine}>
            {rotationStrings.bookRotation}
          </Radio>
          {/* A workspace link is on nobody's profile, so Link only means nothing for it. */}
          {!isLinkOnly && (
            <Radio value="everyone" icon="building" description={rotationStrings.bookEveryoneLine}>
              {rotationStrings.bookEveryone}
            </Radio>
          )}
        </RadioGroup>
      )}
      {isTeam &&
        (rotationItems.length === 0 && rotations.status === 'ready' ? (
          <Callout
            tone="info"
            actions={
              <Link href={roundRobinHref(slug)} opensInNewTab>
                {rotationStrings.manageRotations}
              </Link>
            }
          >
            {rotationStrings.noRotations}
          </Callout>
        ) : (
          <Select
            label={rotationStrings.rotation}
            placeholder={rotationStrings.pickRotation}
            // Only when the group made in the other tab replaced the focused link, so focus isn't dropped.
            // eslint-disable-next-line jsx-a11y-x/no-autofocus
            autoFocus={focusGroups}
            items={rotationItems}
            value={rotationId}
            onChange={setRotationId}
            isRequired
            isDisabled={isBusy}
            {...(rotationError === undefined ? {} : { error: rotationError })}
          />
        ))}
    </Modal>
  );
}
