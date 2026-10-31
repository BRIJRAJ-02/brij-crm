// Brief
// Purpose: New booking page (spec 0025 experience, AC-678): a centred dialog, "Add a booking page" (the owner's call on 19 October 2026, over the side panel).
// Main task: a title, one length and the schedule it books by, then Create page into the editor.
// An admin also chooses who it books: themselves, one host from a rotation (spec 0029, AC-732), or everyone on the roster, which makes a workspace link (30 Oct 2026); a round robin page's other hosts are set in its editor.
// Leaves out: everything else a page has (its editor), and its web address part: the server makes a free one from the title (22 October 2026: it shows nowhere a visitor sees, since links use the page's key).
import { isDataError, type BookingPageView, type DataLayer } from '@crm/data';
import { useCaptureList, useSchedules } from '@crm/data/react';
import { Button, Callout, Field, InfoTip, Link, Modal, Radio, RadioGroup, SegmentedControl, Select } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings as rotationStrings } from './rotation-strings.ts';
import { lengthOf } from './durations.ts';
import { memberZone } from './zone.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { scheduleChoices } from './schedules.ts';
import { strings } from './strings.ts';
import { roundRobinHref } from './links.ts';

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
  /**
   * The reader may make forms (`forms.manage`): the dialog offers the Team link (spec 0037, AC-1353), a form in front
   * of the live team pages, made in one step; `onTeamLink` then opens its editor.
   */
  readonly onTeamLink?: (formId: string) => void;
  /** Opened as New › Team link (`?new=team-link`): the Team link is chosen. */
  readonly isTeamLinkAsked?: boolean;
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
  onTeamLink,
  isTeamLinkAsked = false,
}: NewPageDialogProps) {
  const [title, setTitle] = useState('');
  // A segment's minutes, or `custom` with the typed minutes beside it.
  const [length, setLength] = useState('30');
  const [custom, setCustom] = useState('');
  // `default` follows the member's default schedule (spec 0035); any other id names one of their schedules.
  const [schedule, setSchedule] = useState('default');
  // The member's schedules, held only while the dialog is open: it is mounted, closed, under all of Captures.
  const schedules = useSchedules(isOpen ? data.schedules.view(slug, undefined, memberZone(data, slug)) : undefined);
  const choices = schedules.status === 'ready' ? schedules.schedules : [];
  // `everyone` makes the workspace's own link, booking whoever on the roster is free (team scheduling, decision 3).
  const [who, setWho] = useState<'me' | 'rotation' | 'everyone' | 'team-link'>(isTeamLinkAsked ? 'team-link' : 'me');
  // Asked for as New › Team link while the dialog was already mounted: it opens on the Team link.
  const [wasAsked, setWasAsked] = useState(isTeamLinkAsked);
  if (isTeamLinkAsked !== wasAsked) {
    setWasAsked(isTeamLinkAsked);
    if (isTeamLinkAsked) setWho('team-link');
  }
  const canTeamLink = onTeamLink !== undefined && !isLinkOnly;
  const isTeamLink = canTeamLink && who === 'team-link';
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
  const [formId, setFormId] = useState(() => data.forms.newId());
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
    setFormId(data.forms.newId());
  };
  // The Team link (spec 0037, AC-1353): one form made at once, then its editor.
  const createTeamLink = () => {
    if (isBusy || onTeamLink === undefined) return;
    setBusy(true);
    setFailure(undefined);
    data.forms
      .create(slug, { id: formId, starter: 'team_link', ...(title.trim() === '' ? {} : { name: title.trim() }) })
      .then(
        (form) => {
          setBusy(false);
          reset();
          onTeamLink(form.id);
        },
        (error: unknown) => {
          setBusy(false);
          setFailure(isDataError(error) ? error.message : strings.somethingWrong);
        },
      );
  };
  const create = () => {
    if (isTeamLink) {
      createTeamLink();
      return;
    }
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
        // A round robin page books by each host's own hours, so it names no schedule.
        settings: {
          ...(isTeam || isWorkspace
            ? { durations: [minutes] }
            : { durations: [minutes], scheduleId: schedule === 'default' ? null : schedule }),
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
      title={isLinkOnly ? strings.addLinkOnlyPage : isTeamLink ? rotationStrings.addTeamLink : strings.addPage}
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
            {isBusy ? strings.creating : isTeamLink ? rotationStrings.createTeamLink : strings.createPage}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      <Field
        label={strings.title}
        // The Team link's title is its form's name, "Book a call" unless typed.
        placeholder={isTeamLink ? rotationStrings.teamLinkName : strings.titlePlaceholder}
        value={title}
        onChange={(value) => {
          setTitle(value);
          setErrors(({ title: _, ...rest }) => rest);
        }}
        onSubmit={create}
        maxLength={120}
        isRequired={!isTeamLink}
        isDisabled={isBusy}
        // The dialog opens to name the page: its first field is what the press asked for.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        autoFocus
        {...(errors.title === undefined ? {} : { error: errors.title })}
      />
      {(canBookTeams || canTeamLink) && (
        <RadioGroup
          label={rotationStrings.whoBooks}
          variant="cards"
          value={who}
          isDisabled={isBusy}
          onChange={(value) => {
            if (value === 'me' || value === 'rotation' || value === 'everyone' || value === 'team-link') setWho(value);
          }}
        >
          <Radio value="me" icon="user" description={rotationStrings.bookMeLine}>
            {rotationStrings.bookMe}
          </Radio>
          {canBookTeams && (
            <Radio value="rotation" icon="users" description={rotationStrings.bookRotationLine}>
              {rotationStrings.bookRotation}
            </Radio>
          )}
          {/* A workspace link is on nobody's profile, so Link only means nothing for it. */}
          {canBookTeams && !isLinkOnly && (
            <Radio value="everyone" icon="building" description={rotationStrings.bookEveryoneLine}>
              {rotationStrings.bookEveryone}
            </Radio>
          )}
          {/* A form in front of the team pages: with none live there is nothing to send people to. */}
          {canTeamLink && <TeamLinkRadio data={data} slug={slug} />}
        </RadioGroup>
      )}
      {/* What the choice above decides comes under it, so choosing a card never moves the cards. */}
      {!isTeamLink && (
        <>
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
        </>
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
      {!isTeam && !isWorkspace && !isTeamLink && (
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

/**
 * The Team link's choice (spec 0037, AC-1353): it offers the live team pages, the workspace link among them, so with
 * none it is off and says why. Mounted only while the dialog is open, so the pages are read only then; while they
 * load it stays on (the server refuses a Team link with no page anyway).
 */
function TeamLinkRadio({ data, slug }: { readonly data: DataLayer; readonly slug: string }) {
  const pages = useCaptureList(data.bookingPages.view(slug));
  const hasNone =
    pages.status === 'ready' && !pages.items.some((page) => page.kind === 'round_robin' && page.status === 'live');
  return (
    <Radio
      value="team-link"
      icon="git-branch"
      isDisabled={hasNone}
      description={hasNone ? rotationStrings.teamLinkNone : rotationStrings.teamLinkLine}
    >
      {rotationStrings.teamLink}
    </Radio>
  );
}
