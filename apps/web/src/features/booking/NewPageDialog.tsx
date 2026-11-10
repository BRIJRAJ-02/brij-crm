// Brief
// Purpose: New booking page, the Calendly way (the bookings area, 4 November 2026, after the owner's "what is this
// nonsense"): a title, the page's type as a short list (Just me, selected; Round robin for an admin), and a length.
// Main task: name it and press Create page, which makes it as a draft and opens its editor, where Publish puts it live.
// The header's Team links opens this same dialog as New workspace link or New team link (`kind`), with only what that
// one asks: a title (and a length for the workspace link). A managed page ("A page each") waits under More types.
// Round robin with no group yet asks who is on it right here (6 November 2026, the Calendly way): the people, and the
// group is made from them under the page's name, so the first team page never leaves this dialog.
// Leaves out: the schedule (the page follows the default; another is picked on the editor's Hours tab, as Calendly and
// Cal.com do), everything else a page has (its editor), its web address (the server makes one from the title), the
// workspace and team links as types (they are links, not page types: the header's Team links), and Collective (the
// server can't make one yet). No choice is ever shown turned off: one that can't apply is left out.
import { isDataError, type BookingPageView, type DataLayer, type MemberSummary } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import { Button, Callout, Disclosure, Field, Link, Modal, SegmentedControl, Select, TileGrid } from '@crm/ui';
import { useEffect, useState } from 'react';
import { strings as rotationStrings } from './rotation-strings.ts';
import { lengthOf } from './durations.ts';
import { memberZone } from './zone.ts';
import { strings } from './strings.ts';
import { managedStrings } from './managed-strings.ts';
import { membersSettingsHref } from '../settings/nav.ts';

/** The lengths offered as segments; any other the server allows goes through Custom. */
const SEGMENTS = [15, 30, 45, 60] as const;
const CUSTOM = 'custom';

/** A group made here starts as Round robin's own New group does: fair, over 30 days, returning guests to their owner. */
const NEW_GROUP_RULES = { strategy: 'fair', windowDays: 30, evenGap: 3, returning: 'owner' } as const;
const GROUP_NAME_MAX = 80;
const NEW_GROUP_MEMBER = { weight: 100, priority: 2, dailyCap: null, weeklyCap: null, isOn: true } as const;

/** The workspace's people, for a first group. */
type PeopleRead =
  { readonly status: 'loading' | 'failed' } | { readonly status: 'ready'; readonly people: readonly MemberSummary[] };

/** What the dialog makes: a page (the default), the workspace's own link, or a Team link (a form). */
export type NewPageKind = 'page' | 'workspace' | 'team-link';

/** A page's type, as the list offers it. */
type PageType = 'me' | 'rotation' | 'managed';

/** Props for the dialog. */
export interface NewPageDialogProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The reader may book a rotation's hosts (booking.admin): the list offers Round robin. */
  readonly canBookTeams?: boolean;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  /** The page exists, as a draft: the caller opens its editor, where Publish puts it live. */
  readonly onCreated: (page: BookingPageView) => void;
  /** Makes it Link only from the start (Bookings' "Create a link only page", for reserved time). */
  readonly isLinkOnly?: boolean;
  /** What it makes; `page` unless the header's Team links asked for the workspace link or a Team link. */
  readonly kind?: NewPageKind;
  /** A Team link was made (spec 0037, AC-1353): the caller opens its form's editor. */
  readonly onTeamLink?: (formId: string) => void;
  /**
   * The reader may set up managed pages (`booking.admin`, spec 0037, AC-1333): More types offers "A page each",
   * which makes the template in one step; `onManaged` then opens its editor.
   */
  readonly onManaged?: (templateId: string) => void;
  /**
   * A group's card asked (Round robin's "Make a booking page"): the dialog opens on Round robin with that group
   * picked. Needs `canBookTeams`.
   */
  readonly rotationId?: string;
}

/**
 * The dialog: Title, then the type (for an admin) and Duration, then Cancel or Create page. The id is minted once per
 * opening, so a retry makes one page.
 */
export function NewPageDialog({
  data,
  slug,
  canBookTeams = false,
  isOpen,
  onClose,
  onCreated,
  isLinkOnly = false,
  kind = 'page',
  onTeamLink,
  onManaged,
  rotationId: askedRotation,
}: NewPageDialogProps) {
  // Round robin first only when a group's card asked for it; otherwise Just me (the owner, 4 November 2026).
  const firstType: PageType = askedRotation !== undefined && canBookTeams ? 'rotation' : 'me';
  const [title, setTitle] = useState('');
  // A segment's minutes, or `custom` with the typed minutes beside it.
  const [length, setLength] = useState('30');
  const [custom, setCustom] = useState('');
  // Just me, always first and chosen (the owner, 4 November 2026: nothing else is ever pre-selected).
  const [type, setType] = useState<PageType>(firstType);
  // More types, folded until opened; held open while its type is the one chosen, so the choice never hides.
  const [isMoreOpen, setMoreOpen] = useState(false);
  const isTeamLink = kind === 'team-link' && onTeamLink !== undefined;
  const isWorkspace = kind === 'workspace' && canBookTeams;
  const isPage = !isTeamLink && !isWorkspace;
  // A managed page is nobody's bookable page: Link only means nothing for it.
  const canManaged = isPage && onManaged !== undefined && !isLinkOnly;
  const isManaged = canManaged && type === 'managed';
  const isTeam = isPage && canBookTeams && type === 'rotation';
  const [rotationId, setRotationId] = useState<string | null>(askedRotation ?? null);
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
  // The group the page books: the one picked, else the workspace's only group, so a team with one needn't pick it.
  const onlyRotation = rotationItems.length === 1 ? rotationItems[0]?.id : undefined;
  const pickedRotation = rotationId ?? onlyRotation ?? null;
  // No group yet: who is on it is asked here, and the group is made from them with the page.
  const needsPeople = isOpen && isTeam && rotations.status === 'ready' && rotationItems.length === 0;
  const [people, setPeople] = useState<PeopleRead>({ status: 'loading' });
  const [peopleAsked, setPeopleAsked] = useState(0);
  const [picked, setPicked] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!needsPeople) return;
    let isCurrent = true;
    data.members.list(slug).then(
      (found) => {
        if (isCurrent) setPeople({ status: 'ready', people: found });
      },
      () => {
        if (isCurrent) setPeople({ status: 'failed' });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [needsPeople, peopleAsked, data, slug]);
  // Invite teammates opens beside this dialog (flow walks B8), so someone who joined, or a group made there, arrives
  // when this tab is back in front.
  useEffect(() => {
    if (!needsPeople) return;
    const reread = () => {
      if (document.visibilityState !== 'visible') return;
      data.rotations.view(slug).reload();
      setPeopleAsked((count) => count + 1);
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => {
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [needsPeople, data, slug]);
  const [newGroupId, setNewGroupId] = useState(() => data.rotations.newId());
  const [id, setId] = useState(() => data.bookingPages.newId());
  // The Team link's form id, minted at its first Create and kept for a retry, so a retry makes one form.
  const [formId, setFormId] = useState<string | undefined>(undefined);
  // The template's id, minted once per opening so a retry makes one managed page.
  const [managedId, setManagedId] = useState(() => data.managedPages.newId());
  const [isBusy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ readonly title?: string; readonly custom?: string }>({});
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const reset = () => {
    setTitle('');
    setLength('30');
    setCustom('');
    setType(firstType);
    setMoreOpen(false);
    setRotationId(askedRotation ?? null);
    setRotationError(undefined);
    setPicked([]);
    setPeople({ status: 'loading' });
    setNewGroupId(data.rotations.newId());
    setErrors({});
    setFailure(undefined);
    setId(data.bookingPages.newId());
    setFormId(undefined);
    setManagedId(data.managedPages.newId());
  };
  // The Team link (spec 0037, AC-1353): one form made at once, then its editor.
  const createTeamLink = () => {
    if (isBusy || onTeamLink === undefined) return;
    setBusy(true);
    setFailure(undefined);
    const teamLinkId = formId ?? data.forms.newId();
    setFormId(teamLinkId);
    data.forms
      .create(slug, { id: teamLinkId, starter: 'team_link', ...(title.trim() === '' ? {} : { name: title.trim() }) })
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
  // A managed page (AC-1333): the template made at once, then its editor, where its locks and its people are set.
  const createManaged = () => {
    if (isBusy || onManaged === undefined) return;
    const found = title.trim() === '' ? { title: strings.titleRequired } : {};
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure(undefined);
    data.managedPages.create(slug, { id: managedId, title: title.trim(), timeZone: memberZone(data, slug) }).then(
      (template) => {
        setBusy(false);
        reset();
        onManaged(template.id);
      },
      (error: unknown) => {
        setBusy(false);
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        if (isDataError(error) && field === 'title') setErrors({ title: error.message });
        else setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };
  const create = () => {
    if (isTeamLink) {
      createTeamLink();
      return;
    }
    if (isManaged) {
      createManaged();
      return;
    }
    if (isBusy) return;
    const minutes = length === CUSTOM ? lengthOf(custom) : lengthOf(length);
    const found = {
      ...(title.trim() === '' ? { title: strings.titleRequired } : {}),
      ...(minutes === undefined ? { custom: strings.customMinutesInvalid } : {}),
    };
    setErrors(found);
    const makesGroup = isTeam && needsPeople;
    const missingRotation = isTeam && (makesGroup ? picked.length < 2 : pickedRotation === null);
    setRotationError(
      missingRotation ? (makesGroup ? rotationStrings.needTwo : rotationStrings.rotationRequired) : undefined,
    );
    if (minutes === undefined || Object.keys(found).length > 0 || missingRotation) return;
    setBusy(true);
    setFailure(undefined);
    // The group first, from the people picked and the page's name; a retry reuses its id, so one group is made.
    const groupFirst = makesGroup
      ? data.rotations
          .create(slug, {
            id: newGroupId,
            // A title may run longer than a group's name.
            settings: { ...NEW_GROUP_RULES, name: title.trim().slice(0, GROUP_NAME_MAX) },
            members: picked.map((memberId) => ({ memberId, ...NEW_GROUP_MEMBER })),
          })
          .then((group) => group.id)
      : Promise.resolve(pickedRotation);
    groupFirst
      .then((groupId) =>
        data.bookingPages.create(slug, {
          id,
          title: title.trim(),
          timeZone: memberZone(data, slug),
          // Live at once, as a Calendly event type is (the owner, 9 November 2026: no draft or Publish); Hidden is the
          // editor's and the card's Live or Hidden menu.
          // A one on one page follows the default schedule (AC-17); a round robin page books by each host's own hours.
          settings: {
            ...(isTeam || isWorkspace ? { durations: [minutes] } : { durations: [minutes], scheduleId: null }),
            ...(isLinkOnly && !isWorkspace ? { isPrivate: true } : {}),
          },
          ...(isTeam && groupId !== null
            ? // A team's page gets the workspace's address (owner, 5 November 2026); pages made before keep theirs.
              {
                kind: 'round_robin' as const,
                scope: 'workspace' as const,
                hosts: { fixed: [], rotations: [groupId] },
              }
            : {}),
          ...(isWorkspace ? { kind: 'round_robin' as const, scope: 'workspace' as const } : {}),
        }),
      )
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
  const pick = (value: string) => {
    if (value === 'me' || value === 'rotation' || value === 'managed') setType(value);
  };
  // The types, each a mark, a name and one plain line (Calendly's New event type). Round robin is booking.admin's.
  const types = [
    { id: 'me', name: strings.typeMe, icon: 'user' as const, description: strings.typeMeLine },
    ...(canBookTeams
      ? [
          {
            id: 'rotation',
            name: strings.typeRoundRobin,
            icon: 'refresh-cw' as const,
            description: strings.typeRoundRobinLine,
          },
        ]
      : []),
  ];
  return (
    <Modal
      // The name stays put while a type is picked: picking one is a choice in the dialog, not another dialog.
      title={
        isTeamLink
          ? strings.addTeamLink
          : isWorkspace
            ? strings.addWorkspaceLink
            : isLinkOnly
              ? strings.addLinkOnlyPage
              : strings.addPage
      }
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
      {/* The type, for whoever has more than one to pick: Just me is chosen, and anything rarer waits under More
          types. One list, so a type under More types is picked as the others are. */}
      {isPage && (canBookTeams || canManaged) && (
        <>
          <TileGrid
            variant="choice"
            label={strings.typeLabel}
            isLabelVisible
            showsDescription
            tileWidth="wide"
            value={type === 'managed' ? null : type}
            tiles={isBusy ? types.map((tile) => ({ ...tile, isDisabled: true })) : types}
            onChange={pick}
          />

          {canManaged && (
            <Disclosure
              title={strings.moreTypes}
              variant="quiet"
              isExpanded={isMoreOpen || type === 'managed'}
              onExpandedChange={setMoreOpen}
            >
              <TileGrid
                variant="choice"
                label={strings.moreTypes}
                showsDescription
                tileWidth="wide"
                value={type === 'managed' ? 'managed' : null}
                tiles={[
                  {
                    id: 'managed',
                    name: managedStrings.bookManaged,
                    icon: 'layers',
                    description: strings.typeManagedLine,
                    ...(isBusy ? { isDisabled: true } : {}),
                  },
                ]}
                onChange={pick}
              />
            </Disclosure>
          )}
        </>
      )}
      {/* Who it books, straight after the type: the choice that makes it a team page. */}
      {isTeam &&
        (needsPeople ? (
          people.status === 'failed' ? (
            <Callout
              tone="danger"
              isAnnounced
              actions={<Button onPress={() => setPeopleAsked((count) => count + 1)}>{strings.retryPeople}</Button>}
            >
              {strings.peopleFailed}
            </Callout>
          ) : people.status === 'ready' && people.people.length < 2 ? (
            // Pressing Create page here says the same, louder: it can't go until there is someone to share with.
            <Callout
              tone={rotationError === undefined ? 'info' : 'danger'}
              isAnnounced
              // Opens beside the dialog, so what is typed here stays (flow walks B8).
              actions={
                <Link href={membersSettingsHref(slug)} opensInNewTab>
                  {strings.inviteTeammates}
                </Link>
              }
            >
              {strings.needsTeammates}
            </Callout>
          ) : (
            <Select
              label={rotationStrings.people}
              selectionMode="multiple"
              placeholder={rotationStrings.peoplePlaceholder}
              items={(people.status === 'ready' ? people.people : []).map((member) => ({
                id: member.id,
                label: member.name,
                description: member.email,
              }))}
              isSearchable
              searchLabel={rotationStrings.addMemberPlaceholder}
              values={[...picked]}
              hint={strings.peopleLine}
              onValuesChange={(ids) => {
                setPicked(ids);
                setRotationError(undefined);
              }}
              isRequired
              isDisabled={isBusy || people.status === 'loading'}
              {...(rotationError === undefined ? {} : { error: rotationError })}
            />
          )
        ) : (
          <Select
            label={rotationStrings.rotation}
            placeholder={rotationStrings.pickRotation}
            items={rotationItems}
            value={pickedRotation}
            onChange={setRotationId}
            isRequired
            isDisabled={isBusy}
            {...(rotationError === undefined ? {} : { error: rotationError })}
          />
        ))}
      {/* A length for anything that books; a Team link and a managed page take theirs in their editors. */}
      {!isTeamLink && !isManaged && (
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
    </Modal>
  );
}
