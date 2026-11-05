// Brief
// Purpose: one booking page's editor (spec 0025, 0025-experience.md, AC-623, AC-624, AC-679): its groups beside the page.
// Main task: change the page, the meeting, its hours and limits, and Save from the bar that appears while anything is unsaved.
// One tab per group (the owner, 22 Oct 2026: the cards stacked were too much to look through), the chosen one in
// `?tab=`; a tab whose fields hold an error carries a dot. Each tab's headed sections (Cards) fill the first two
// thirds (the owner, 23 Oct 2026: "full width the left"), beside the page in a phone in the last third (the owner,
// 22 Oct 2026, after the masonry columns: "bring back the visual on the side, with just mobile view").
// The hours are a schedule's (spec 0035, AC-965): the tab picks one of the owner's and edits its week and days off in
// place (the owner, 22 Oct 2026, like Calendly's and Cal.com's event Availability tab), saved by the same Save.
// A round robin page (spec 0029, AC-732) adds Hosts: its fixed hosts, its rotations, and who reschedules go to.
// Questions (spec 0057): the form builder's own section, shared, under a Where the answers go picker (the page's
// object, People unless it names another, booking answers parity 27 Oct 2026); a question with nothing to file onto
// gets an attribute on that object on Save, with Undo, as a form's publish does.
// Leaves out: the deal step (milestone 2), collective members, and the profile's order (pages keep the
// order they were made in until the Links list can be reordered by drag).
import {
  BOOKING_DRAFT_KEYS,
  BRAND_QUICK_PICKS,
  isDataError,
  MANAGED_PARTS,
  type BookingPageSettings,
  type BookingPageView,
  type DataLayer,
  type FormTargetChoices,
  type ManagedPart,
  type MemberSummary,
  type ObjectSummary,
  type ScheduleView,
  type PublicSocialLink,
  type SchedulesView,
} from '@crm/data';
import { useCalendar, useCaptureList, usePageDestination, useSchedules } from '@crm/data/react';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  ChoiceChips,
  CopyButton,
  DescriptionList,
  EditorStatus,
  EmptyState,
  focusLater,
  Field,
  InfoTip,
  Modal,
  PreviewFrame,
  PreviewLayout,
  Popover,
  SaveBar,
  SegmentedControl,
  Select,
  SettingsRow,
  SettingsStack,
  Skeleton,
  Switch,
  TabPanel,
  Tabs,
  Tooltip,
  TopBar,
  type SaveBarStatus,
  type SelectItem,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { pageHeading } from '../navigation/focus.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { QuestionsSection } from '../questions/QuestionsSection.tsx';
import { changeQuestion, planNewAttributes, type Questions } from '../questions/questions.ts';
import { questionsProblem } from '@crm/data/forms';
import { archiveMadeAttributes, createPlannedAttributes, type MadeAttribute } from '../questions/attributes.ts';
import { strings as questionStrings } from '../questions/strings.ts';
import { linkPageHref } from '../link-page/nav-strings.ts';
import { brandSettingsHref, objectSettingsHref, profileHref } from '../settings/nav.ts';
import { PageAppearance } from './PageAppearance.tsx';
import { lengthChoices, lengthOf, LENGTHS_MAX } from './durations.ts';
import { managedStrings } from './managed-strings.ts';
import { ShareBlock } from '../forms/ShareBlock.tsx';
import { noVideoLinkReason } from './destination.ts';
import { LeaveGuard } from '../navigation/LeaveGuard.tsx';
import { PageConflicts, PageDestination } from './PageDestination.tsx';
import { HostsCard } from './HostsCard.tsx';
import { pageFacts } from '../routing/facts.ts';
import { FormOnlyCard } from './FormOnlyCard.tsx';
import type { RecordFields } from '../routing/record-fields.ts';
import { RulesCard } from '../routing/RulesCard.tsx';
import { strings as routingStrings } from '../routing/strings.ts';
import { weekGroups } from './hours.ts';
import { zoneDisplay } from '../../public/booking/time.ts';
import { DaysOff } from './DaysOff.tsx';
import { WeekCard, WeekCardPending } from './ScheduleEditor.tsx';
import { useScheduleDraft } from './scheduleDraft.ts';
import { changed, draftAfterSave } from './pageDraft.ts';
import { EditorActions } from '../captures/EditorActions.tsx';
import { bookingsTabHref } from '../bookings/tabs.ts';
import { strings as capturesStrings } from '../captures/strings.ts';
import { DeletePageDialog } from './DeletePageDialog.tsx';
import {
  availabilityHref,
  calendarsHref,
  isNotOlder,
  linksHref,
  PAGE_TABS,
  pageEditorHref,
  pagePreviewHref,
  pageTabOf,
  publicBookingOrigin,
  publicBookingPath,
  publicBookingUrl,
  type PageTab,
} from './links.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings as rotationStrings } from './rotation-strings.ts';
import { EmbedCard } from './EmbedCard.tsx';
import { OneOffLinksCard } from './OneOffLinksCard.tsx';
import { RequestsCard } from './RequestsCard.tsx';
import { SharingPanel } from './SharingPanel.tsx';
import { sharingStrings } from './sharing-strings.ts';
import { scheduleChoices } from './schedules.ts';
import { strings } from './strings.ts';
import { publishStrings } from './publish-strings.ts';
import { insightsHref } from '../insights/search.ts';
import { activityStrings } from './activity-strings.ts';
import { PageBookingsTab, PageInsightsTab } from './PageActivityTabs.tsx';
import { ShareTimesCard } from './ShareTimesCard.tsx';
import { isDraftPage } from './draft-page.ts';
import { canMatchVisitor } from './visitor-match.ts';
import { SocialsCardSlot } from './socials-slot.tsx';
import { strings as socialsStrings } from './socials-strings.ts';

/** Props for the editor: the page its route loaded. */
export interface PageEditorProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: BookingPageView;
  /** The reader's language, for the hours summary's days and clock. */
  readonly locale: string;
  /** The page owner's schedules (spec 0035), when the reader may read them: the Hours card's choices. */
  readonly schedules?: SchedulesView;
  /** The owner's id as `?member=` takes it, when the owner isn't the reader (an admin's view). */
  readonly ownerMember?: string;
  /** The workspace's active members, on a round robin page: its fixed host picker. */
  readonly people?: readonly MemberSummary[];
  /** The workspace's active members for Sharing's picker, for an admin (spec 0037, AC-1331). */
  readonly sharingPeople?: readonly MemberSummary[];
  /** Says a change that saved at once went through (the Hosts card's). */
  readonly onNotice?: (message: string) => void;
  /** A round robin page's Routing card (spec 0043): the person's and company's fields its rules may read. */
  readonly recordFields?: RecordFields;
  /** The tab shown, from `?tab=`. */
  readonly tab: PageTab;
  /** Shows another tab: the route puts it in `?tab=`. */
  readonly onTabChange: (tab: PageTab) => void;
  /** Where the page's answers may be filed (spec 0057): its object's attributes; absent when the read failed. */
  readonly targets?: FormTargetChoices;
  /** The workspace's objects, for the Questions tab's "Where the answers go" picker; none leaves it out. */
  readonly objects?: readonly ObjectSummary[];
}

/** The most questions a booking page asks (spec 0057, AC-5701: the contracts' `BOOKING_QUESTIONS_MAX`). */
const QUESTIONS_MAX = 20;

const LOCATIONS = ['video', 'address', 'phone', 'custom'] as const;
/** Location's "I'll send a link": video with no link, the host sending it (critic B-07). */
const SEND_LINK = 'send-link';

const minutesItems = (values: readonly number[]): SelectItem[] =>
  values.map((value) => ({ id: String(value), label: value === 0 ? strings.none : strings.minutes(value) }));
const BUFFERS = minutesItems([0, 5, 10, 15, 20, 30, 45, 60]);
const NOTICE: SelectItem[] = [
  { id: '0', label: strings.none },
  ...[15, 30].map((value) => ({ id: String(value), label: strings.minutes(value) })),
  ...[1, 2, 4, 12].map((value) => ({ id: String(value * 60), label: strings.hoursCount(value) })),
  ...[1, 2, 3, 7, 14].map((value) => ({ id: String(value * 1440), label: strings.days(value) })),
];
/** How close to the start a guest may still cancel or move: Any time, or a cutoff (critic A23: not "None"). */
const CUTOFF: SelectItem[] = [{ id: '0', label: strings.anyTime }, ...NOTICE.slice(1)];
const WINDOW: SelectItem[] = [7, 14, 30, 60, 90, 180, 365].map((value) => ({
  id: String(value),
  label: strings.days(value),
}));
const DAILY: SelectItem[] = [
  { id: 'none', label: strings.noLimit },
  ...[1, 2, 3, 4, 5, 6, 8, 10, 15, 20].map((value) => ({ id: String(value), label: String(value) })),
];
const STEPS: SelectItem[] = [
  { id: 'duration', label: strings.stepDuration },
  ...[15, 30, 60].map((value) => ({ id: String(value), label: strings.minutes(value) })),
];

/** Whether a setting waits in the draft for Publish (spec 0068, AC-6810), as against one that goes live on save. */
const isDraftedKey = (key: string): boolean => (BOOKING_DRAFT_KEYS as readonly string[]).includes(key);

/** One published version, as the Versions dialog lists it. */
interface PageVersionRow {
  readonly version: number;
  readonly isCurrent: boolean;
  readonly label: string;
}

/**
 * Where the page stands, as the header's one status says it (the bookings area, 4 November 2026, as a form's does):
 * Draft until its first Publish, Paused, Live · edited while guests don't see some changes yet, else Live.
 */
function statusOf(
  page: BookingPageView,
  hasUnpublished: boolean,
): { readonly tone: 'live' | 'changed' | 'draft' | 'paused'; readonly text: string } {
  if (isDraftPage(page)) return { tone: 'draft', text: publishStrings.statusDraft };
  if (page.status === 'paused') return { tone: 'paused', text: strings.statusOff };
  if (hasUnpublished) return { tone: 'changed', text: publishStrings.statusChanged };
  return { tone: 'live', text: strings.statusLive };
}

/** The tab each setting sits on, for a refusal that names its field. */
const FIELD_TABS: Readonly<Record<string, PageTab>> = {
  slug: 'page',
  profileSection: 'share',
  profilePosition: 'share',
  description: 'page',
  isPrivate: 'page',
  showSocials: 'share',
  defaultView: 'appearance',
  questions: 'questions',
  answersObjectId: 'questions',
  fileToCrm: 'meeting',
  // Spec 0062, L1: what happens after a booking on the meeting's tab, the guests' cutoffs with the other limits.
  afterBooking: 'meeting',
  redirectUrl: 'meeting',
  sendBookingDetails: 'meeting',
  requiresConfirmation: 'meeting',
  cancelCutoffMinutes: 'hours',
  moveCutoffMinutes: 'hours',
  title: 'meeting',
  durations: 'meeting',
  location: 'meeting',
  rescheduleHost: 'hosts',
  scheduleId: 'hours',
  bufferBefore: 'hours',
  bufferAfter: 'hours',
  minNoticeMinutes: 'hours',
  windowDays: 'hours',
  dailyLimit: 'hours',
  slotStep: 'hours',
};

/** The settings the preview's times come from, read from the server: it shows them only once saved. */
const TIME_KEYS: readonly (keyof BookingPageSettings)[] = [
  'scheduleId',
  'bufferBefore',
  'bufferAfter',
  'minNoticeMinutes',
  'windowDays',
  'dailyLimit',
  'slotStep',
];

/** The settings the editor edits, from the page. */
const settingsOf = (page: BookingPageView): BookingPageSettings => ({
  title: page.title,
  description: page.description,
  slug: page.slug,
  durations: page.durations,
  location: page.location,
  bufferBefore: page.bufferBefore,
  bufferAfter: page.bufferAfter,
  minNoticeMinutes: page.minNoticeMinutes,
  windowDays: page.windowDays,
  dailyLimit: page.dailyLimit,
  slotStep: page.slotStep,
  status: page.status,
  scheduleId: page.scheduleId,
  rescheduleHost: page.rescheduleHost,
  isPrivate: page.isPrivate,
  showSocials: page.showSocials,
  defaultView: page.defaultView,
  profileSection: page.profileSection,
  profilePosition: page.profilePosition,
  questions: page.questions,
  fileToCrm: page.fileToCrm,
  answersObjectId: page.answersObjectId,
  formOnly: page.formOnly,
  afterBooking: page.afterBooking,
  redirectUrl: page.redirectUrl,
  sendBookingDetails: page.sendBookingDetails,
  cancelCutoffMinutes: page.cancelCutoffMinutes,
  moveCutoffMinutes: page.moveCutoffMinutes,
  requiresConfirmation: page.requiresConfirmation,
  linksOnly: page.linksOnly,
});

/** Why a redirect address can't be saved (spec 0062, AC-6201), or undefined when it can. */
function redirectProblem(draft: BookingPageSettings): string | undefined {
  if (draft.afterBooking !== 'redirect') return undefined;
  const url = (draft.redirectUrl ?? '').trim();
  if (url === '') return strings.redirectRequired;
  return URL.canParse(url) && /^https:\/\//i.test(url) ? undefined : strings.redirectInvalid;
}

/** Why a slug can't be sent, in plain words, or undefined when it can. */
function slugProblem(value: string): string | undefined {
  if (value === '') return strings.slugRequired;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 60 ? undefined : strings.slugInvalid;
}

/** Whether a draft is fine to send: the server would refuse it otherwise. */
/** A host's own meeting link that can't be saved: empty, or not an https address (critic B-07). */
function meetingLinkProblem(location: BookingPageSettings['location']): string | undefined {
  if (location.type !== 'video' || location.link === undefined) return undefined;
  const link = location.link.trim();
  if (link === '') return strings.meetingLinkRequired;
  return URL.canParse(link) && new URL(link).protocol === 'https:' ? undefined : strings.meetingLinkInvalid;
}

function sendable(draft: BookingPageSettings): boolean {
  return (
    draft.title.trim() !== '' &&
    slugProblem(draft.slug) === undefined &&
    draft.durations.length > 0 &&
    (draft.location.type === 'video' || draft.location.type === 'phone' || draft.location.value.trim() !== '') &&
    meetingLinkProblem(draft.location) === undefined &&
    redirectProblem(draft) === undefined
  );
}

/** The editor. */
export function PageEditor({
  data,
  slug,
  page: loaded,
  locale,
  schedules,
  ownerMember,
  people = [],
  sharingPeople,
  onNotice,
  recordFields,
  tab,
  onTabChange,
  targets: loadedTargets,
  objects = [],
}: PageEditorProps) {
  const [page, setPage] = useState(loaded);
  // Where answers may be filed (spec 0057): read again once Save adds attributes, or Undo archives them.
  // Undefined when the read failed: the Questions tab says so, with Try again, rather than offering nowhere to file.
  const [targets, setTargets] = useState<FormTargetChoices | undefined>(loadedTargets);
  const choices: FormTargetChoices = useMemo(() => targets ?? { items: [] }, [targets]);
  const [isReadingTargets, setReadingTargets] = useState(false);
  // Adding attributes needs `schema.manage`; without it a question with nothing to file onto stays with the booking.
  const canBuild = useCan('schema.manage');
  // Sharing (spec 0037, AC-1331): whoever may change the page sees its editors; only an admin changes them.
  const canShare = useCan('booking.admin');
  const [isSharing, setSharing] = useState(false);
  // Mounted from its first opening on, so the dialog keeps its rows while it plays its exit.
  const [hasShared, setShared] = useState(false);
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // A page the reader can't change shows as it is, every control read only, with no Save.
  const isLocked = !page.canChange;
  // From a managed template (spec 0037, AC-1333, AC-1334): the parts the workspace sets are read only here, and
  // the note above the tabs names them. The server refuses a write to one whatever this renders, so these are
  // labels over a guard, never the guard itself.
  const workspaceSets: ReadonlySet<ManagedPart> = new Set(page.lockedParts ?? []);
  const readOnly = (part: ManagedPart) => isLocked || workspaceSets.has(part);
  // The link page is the viewer's own: only the page's owner places it there (an admin editing a teammate's page doesn't).
  // A workspace link is nobody's own (30 Oct 2026): no handle, no profile, no social links, only its /b/ link.
  const isWorkspace = page.scope === 'workspace';
  const isOwnPage = ownerMember === undefined && !isWorkspace;
  const saved = settingsOf(page);
  const [draft, setDraft] = useState(saved);
  // The address's shape is said once the person leaves the field, not at every key.
  const [isSlugLeft, setSlugLeft] = useState(false);
  // The meeting link's error waits until the field is left, as the address's does.
  const [isLinkLeft, setLinkLeft] = useState(false);
  // The redirect address's error waits until the field is left, as the address's does.
  const [isRedirectLeft, setRedirectLeft] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
  // Publish (spec 0068, AC-6810 to AC-6812): Save keeps the guest facing settings as the page's draft, and the bar at
  // the head says what guests don't see yet until Publish. What stays instant (AC-6813) is saved as before.
  const [isPublishing, setPublishing] = useState(false);
  // The first Publish's moment, "<page> is live" with its link (the forms' live dialog, the same share part).
  const [liveShown, setLiveShown] = useState<BookingPageView | undefined>(undefined);
  // Publish pressed with unsaved changes: they save first, and the save that lands publishes.
  const publishAfterSave = useRef(false);
  const [isVersionsOpen, setVersionsOpen] = useState(false);
  const [isVersionsFailed, setVersionsFailed] = useState(false);
  // The header's ⋯: where focus goes once Publish or the live dialog has left (as the forms editor's `moreRef`).
  const moreRef = useRef<HTMLButtonElement>(null);
  // Preview pressed over unsaved changes: the tab it opened, which goes to the preview once the save lands.
  const previewAfterSave = useRef<Window | undefined>(undefined);
  const [isDiscardAsked, setDiscardAsked] = useState(false);
  const [publishProblem, setPublishProblem] = useState<
    { readonly message: string; readonly field?: string } | undefined
  >(undefined);
  const [versions, setVersions] = useState<readonly PageVersionRow[] | undefined>(undefined);
  // A version picked while the draft holds changes waits for a yes (spec 0068, AC-6812): restoring replaces them.
  const [restoreAsked, setRestoreAsked] = useState<number | undefined>(undefined);
  // The route shows its cached read first and reads again behind it (and again on any live change), so a newer
  // read arrives as a new `loaded`: the handle just claimed in Profile (owner, 23 Oct 2026: Copy link kept giving
  // /b/<key>), a pause from the Links card, the editor's own last save. The editor takes it unless it is older
  // than the page it holds, and keeps only the person's own unsaved changes on top, as a save does.
  const [lastLoaded, setLastLoaded] = useState(loaded);
  if (loaded !== lastLoaded) {
    setLastLoaded(loaded);
    if (isNotOlder(loaded, page)) {
      setPage(loaded);
      setDraft((current) => ({
        ...settingsOf(loaded),
        ...changed(saved, current),
        status: settingsOf(loaded).status,
      }));
    }
  }
  const dirty = changed(saved, draft);
  const isPageDirty = !isLocked && Object.keys(dirty).length > 0;
  const hours = useHours(schedules, draft.scheduleId, page, slug, ownerMember);
  // The person's own social links, as the preview shows them while the page's switch is on (booking socials); held
  // only on their own personal page, the one page that shows them.
  const showsSocials = ownerMember === undefined && page.kind === 'personal';
  // The card (loaded on its own, with the person's links store) hands them over as they are now.
  const [previewLinks, setPreviewLinks] = useState<readonly PublicSocialLink[]>([]);
  // The chosen schedule's week and days off, edited in place and saved by the same Save as the page's settings
  // (through the data layer: shown at once, put back if the server refuses).
  const week = useScheduleDraft({
    data,
    slug,
    schedule: hours.schedule ?? standIn(page),
    forMember: ownerMember !== undefined,
    reload: () => schedules?.reload(),
    // Saved shows only for a save that landed; a refused one (another tab saved first) says so and clears it.
    onNotice: (notice) => {
      setJustSaved(notice.tone === 'success');
      if (notice.tone !== 'success') toasts.toast(notice);
    },
  });
  const changeWeek: typeof week.change = (next) => {
    setJustSaved(false);
    week.change(next);
  };
  const isWeekDirty = !isLocked && hours.schedule !== undefined && week.isDirty;
  const isDirty = isPageDirty || isWeekDirty;
  // Changes that wait for Publish (spec 0068, AC-6810): while any are among the unsaved ones, Save says Save draft.
  const isDraftDirty = isPageDirty && Object.keys(dirty).some((key) => isDraftedKey(key));
  const [justSaved, setJustSaved] = useState(false);
  const change = (patch: Partial<BookingPageSettings>) => {
    setJustSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  };
  // The ready picks plus any custom length the page has saved or the draft holds, so turning one off keeps its chip.
  const lengths = lengthChoices(page.durations, draft.durations);
  const addLength = () => {
    const minutes = lengthOf(lengthText);
    if (minutes === undefined) {
      setLengthError(strings.customMinutesInvalid);
      return;
    }
    if (!draft.durations.includes(minutes)) {
      if (draft.durations.length >= LENGTHS_MAX) {
        setLengthError(strings.lengthsFull);
        return;
      }
      change({ durations: [...draft.durations, minutes].sort((left, right) => left - right) });
    }
    setLengthText('');
    setLengthError(undefined);
    setAddingLength(false);
  };
  // When the editor opened: the zone's offset ("GMT+5:30") is read for then.
  const [openedAt] = useState(() => Date.now());
  // The reader's own calendar connections (spec 0024): Location's video line reads them. With none, Meeting's
  // Calendar card and Availability's Conflicts card each say so where it matters, with Connect calendar; there is
  // no page level notice (the bookings area, 4 November 2026).
  const calendar = useCalendar(data.calendar.view(slug));
  // Video with no live calendar makes no link, and Location says so (Q57, Q77): `noVideoLinkReason` says when.
  const destination = usePageDestination(data.calendar.pageDestination(slug, page.id));
  const noLinkReason = noVideoLinkReason({
    kind: page.kind,
    isOwner: destination.status === 'ready' ? destination.destination.isOwner : undefined,
    connections: calendar.status === 'ready' ? calendar.connections.map((connection) => connection.status) : undefined,
  });
  // No calendar of the owner's makes a video link (or theirs needs reconnecting): Location offers "I'll send a link"
  // and Video asks for the host's own link (critic B-07).
  const makesNoLink = noLinkReason !== undefined;
  // A custom length typed in minutes, added to the page's lengths on Add or Enter.
  const [lengthText, setLengthText] = useState('');
  const [lengthError, setLengthError] = useState<string | undefined>(undefined);
  // The "+ Custom" chip's popover, and the minutes typed in it.
  const [isAddingLength, setAddingLength] = useState(false);
  const customRef = useRef<HTMLButtonElement>(null);
  // Which lengths the chips refuse (a fifth), said under the chips rather than in the popover.
  const [chipsError, setChipsError] = useState<string | undefined>(undefined);

  // Pause and Resume save at once, apart from the other groups, and their toast offers Undo.
  const setLive = (status: 'live' | 'paused') => {
    save({ status });
  };
  const duplicate = () => {
    data.bookingPages.duplicate(slug, page, strings.copyOf(page.title)).then(
      (copy) => {
        toasts.toast({ tone: 'success', message: strings.duplicated(copy.title) });
        void navigate({ href: pageEditorHref(slug, copy.id) });
      },
      () => toasts.toast({ tone: 'danger', message: strings.duplicateFailed(page.title) }),
    );
  };
  const [isDeleting, setDeleting] = useState(false);

  // The questions Save gives a People attribute, with no prompt (spec 0057, AC-5707): the same planning a form's
  // publish uses, offered only to someone who may add attributes, while the page files into the CRM.
  const plannedFor = (questions: Questions, fileToCrm: boolean) =>
    planNewAttributes(questions, choices.items, canBuild && !isLocked && fileToCrm && choices.objectId !== undefined);
  // Where the answers go (booking answers parity, 27 Oct 2026), in the shape the forms editor's target picker uses:
  // the objects the person may write, People first. Null on the page means People, so a page made before this
  // setting behaves exactly as it did.
  const liveObjects = useMemo(
    () => objects.filter((object) => !object.isArchived && object.access === 'write'),
    [objects],
  );
  const peopleObject = liveObjects.find((object) => object.standardKey === 'people');
  const answersObject = draft.answersObjectId ?? peopleObject?.id ?? null;
  const [isMovingAnswers, setMovingAnswers] = useState(false);
  // The objects a booking can't file onto, said in the list rather than refused after the pick (crm-f7's booking
  // walk, 28 Oct 2026): a booking knows the guest by email alone, so the object needs a unique email field to find or
  // make their record. Read from each object's attributes, which the data layer holds once read; People always has
  // one. Undefined while they load, when every object is offered and the server still refuses one that can't.
  const [noEmailMatch, setNoEmailMatch] = useState<ReadonlySet<string> | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    Promise.all(
      liveObjects.map((object) =>
        data.attributes
          .list(slug, object.id)
          .then((attributes) => ({
            id: object.id,
            matches: canMatchVisitor(attributes),
          }))
          // Couldn't read: offered, and the server's refusal says why if it can't take bookings.
          .catch(() => ({ id: object.id, matches: true })),
      ),
    ).then(
      (read) => {
        if (isCurrent) setNoEmailMatch(new Set(read.flatMap((each) => (each.matches ? [] : [each.id]))));
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, liveObjects]);
  // The object chosen, when it can no longer take answers: said above the picker, since it is never disabled there.
  const brokenAnswersObject =
    answersObject !== null && noEmailMatch?.has(answersObject) === true
      ? liveObjects.find((object) => object.id === answersObject)
      : undefined;
  const isAnyUnmatched = liveObjects.some(
    (object) => object.id !== answersObject && noEmailMatch?.has(object.id) === true,
  );
  // Changing it saves at once, as the forms editor's does: the server clears the filings the new object has no
  // field for, and the page comes back with the questions to file again. The attribute choices are read afresh.
  const moveAnswers = (objectId: string | null) => {
    const next = objectId === null || objectId === peopleObject?.id ? null : objectId;
    if (isMovingAnswers || next === (draft.answersObjectId ?? null)) return;
    setMovingAnswers(true);
    setFailure(undefined);
    data.bookingPages.update(slug, page.id, { answersObjectId: next, questions: draft.questions }).then(
      (saved) => {
        setMovingAnswers(false);
        setPage(saved);
        setDraft((current) => ({
          ...draftAfterSave(settingsOf(saved), current),
          answersObjectId: saved.answersObjectId,
          questions: saved.questions,
        }));
        void readTargets();
        onNotice?.(strings.answersObjectMoved(liveObjects.find((each) => each.id === next)?.pluralName ?? ''));
      },
      (error: unknown) => {
        setMovingAnswers(false);
        toasts.toast({
          tone: 'danger',
          message: isDataError(error) ? error.message : strings.answersObjectFailed,
        });
      },
    );
  };
  const readTargets = () => {
    setReadingTargets(true);
    return data.bookingPages.attributes(slug, page.id).then(
      (read) => {
        setReadingTargets(false);
        setTargets(read);
      },
      () => setReadingTargets(false),
    );
  };
  // The questions' problem a Save found (a missing label, a choice question with no choices, a Show when that reads a
  // later question, a filing that no longer fits), as a form's publish finds it: shown on its question until fixed.
  const [problemAsked, setProblemAsked] = useState(false);
  const questionProblem = useMemo(
    () =>
      questionsProblem(
        draft.questions,
        new Map(
          choices.items.map((item) => [
            item.attributeId,
            {
              id: item.attributeId,
              title: item.title,
              type: item.type,
              objectName: choices.objectName ?? '',
              // A filing the page already had isn't this writer's choice: the server keeps it as it is.
              canWrite:
                item.canWrite || page.questions.some((question) => question.filedOn?.attributeId === item.attributeId),
            },
          ]),
        ),
      ),
    [draft.questions, choices, page.questions],
  );
  const shownProblem =
    problemAsked && questionProblem?.questionId !== undefined
      ? { questionId: questionProblem.questionId, message: questionProblem.message }
      : undefined;
  const liveQuestionIds = useMemo(() => new Set(page.questions.map((question) => question.id)), [page.questions]);
  // Attributes Save made whose page save hasn't landed yet: the next save that does offers their Undo.
  const madePending = useRef<readonly MadeAttribute[]>([]);
  // The questions as last saved, for Undo: it unfiles from what the page holds now, never from a copy taken earlier.
  const savedQuestions = useRef(page.questions);
  useEffect(() => {
    savedQuestions.current = page.questions;
  }, [page.questions]);
  // Save with the planned attributes made first: each question is filed onto its own, then the page saves, and a
  // toast offers Undo (unfile them, archive the attributes). One that couldn't be made leaves its question unfiled,
  // and a toast says so.
  const saveWithAttributes = (patch: Partial<BookingPageSettings>) => {
    const objectId = choices.objectId;
    const plans = patch.questions === undefined ? [] : plannedFor(patch.questions, draft.fileToCrm);
    if (objectId === undefined || patch.questions === undefined || plans.length === 0) {
      save(patch);
      return;
    }
    const asked = patch.questions;
    setSaving(true);
    setFailure(undefined);
    createPlannedAttributes(data, slug, objectId, plans).then(
      (made) => {
        setSaving(false);
        const questions = made.reduce(
          (list, each) => changeQuestion(list, each.questionId, { filedOn: each.attributeId }),
          asked,
        );
        setDraft((current) => ({
          ...current,
          questions: made.reduce(
            (list, each) => changeQuestion(list, each.questionId, { filedOn: each.attributeId }),
            current.questions,
          ),
        }));
        const missed = plans.filter((plan) => !made.some((each) => each.questionId === plan.questionId));
        if (missed.length > 0) {
          toasts.toast({
            tone: 'danger',
            message: questionStrings.notCreated(
              missed.map((plan) => plan.title),
              choices.objectName ?? '',
            ),
          });
        }
        madePending.current = [...madePending.current, ...made];
        save({ ...patch, questions });
        if (made.length > 0) void readTargets();
      },
      () => {
        setSaving(false);
        save(patch);
      },
    );
  };
  // Undo for attributes Save made: the questions go back to unfiled, in the draft and in what the page holds now,
  // saved at once, and the attributes are archived. A refused save puts the draft's filings back.
  const undoAttributes = (made: readonly MadeAttribute[]) => {
    const unfile = (list: Questions) => [
      // Undo says the field wasn't wanted: kept off the CRM, so the next Save doesn't make it again.
      ...made.reduce((each, one) => changeQuestion(each, one.questionId, { filedOn: null, kept: true }), list),
    ];
    const refile = (list: Questions) => [
      ...made.reduce((each, one) => changeQuestion(each, one.questionId, { filedOn: one.attributeId }), list),
    ];
    setDraft((current) => ({ ...current, questions: unfile(current.questions) }));
    sendSettings({ questions: unfile(savedQuestions.current) }).then(
      (next) => {
        setPage(next);
        setDraft((current) => draftAfterSave(settingsOf(next), current));
        archiveMadeAttributes(data, slug, made).then(readTargets, () =>
          toasts.toast({ tone: 'danger', message: strings.somethingWrong }),
        );
      },
      () => {
        setDraft((current) => ({ ...current, questions: refile(current.questions) }));
        toasts.toast({ tone: 'danger', message: questionStrings.undoFailed });
      },
    );
  };

  /**
   * Sends a change: what guests see goes into the page's draft (spec 0068, AC-6810), anything instant (AC-6813: the
   * status, the address, the profile, privacy, filing) is saved as it always was. The draft goes first: a draft
   * refused (a locked part, a bad length, a question) stops the save before anything instant has gone live, and a
   * draft written that an instant part then refuses is only a draft, which guests never see. One answer, the page
   * as it stands.
   */
  const sendSettings = async (patch: Partial<BookingPageSettings>) => {
    const drafted = Object.fromEntries(Object.entries(patch).filter(([key]) => isDraftedKey(key)));
    const instant = Object.fromEntries(Object.entries(patch).filter(([key]) => !isDraftedKey(key)));
    let next = page;
    if (Object.keys(drafted).length > 0) next = await data.bookingPages.saveDraft(slug, page.id, drafted);
    if (Object.keys(instant).length > 0) next = await data.bookingPages.update(slug, page.id, instant);
    return next;
  };
  /** The page as the server answered a publish, discard or restore: the draft follows, the person's own edits kept. */
  const takePage = (next: typeof page) => {
    setPage(next);
    setDraft((current) => draftAfterSave(settingsOf(next), current));
    setVersions(undefined);
  };
  /**
   * Publish, as a form's (the bookings area, 4 November 2026): the draft goes to guests, and a page made as a draft
   * goes live too, its first Publish ending on "<page> is live" with its link; a later one says Published in a toast.
   * Called with the page a save just answered, so a Publish pressed over unsaved changes publishes what was saved.
   */
  const publish = (current: BookingPageView = page) => {
    publishAfterSave.current = false;
    if (isPublishing) return;
    setPublishing(true);
    setPublishProblem(undefined);
    const wasDraft = isDraftPage(current);
    data.bookingPages
      .publish(slug, current.id)
      .then((published) => {
        // What was published shows at once, so a refused go live below never leaves changes on screen that are gone.
        takePage(published);
        return wasDraft ? data.bookingPages.update(slug, current.id, { status: 'live' }) : published;
      })
      .then(
        (next) => {
          takePage(next);
          setPublishing(false);
          if (wasDraft) setLiveShown(next);
          else {
            toasts.toast({ tone: 'success', message: publishStrings.published(next.title) });
            // Publish has left the header: focus goes to ⋯ rather than falling to the page, as a form's does.
            focusLater(() => moreRef.current);
          }
        },
        (error: unknown) => {
          setPublishing(false);
          const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
          setPublishProblem({
            message: isDataError(error) ? error.message : strings.somethingWrong,
            ...(field === undefined ? {} : { field }),
          });
        },
      );
  };
  /** The page as Discard or Restore left it: the editor shows exactly that, with nothing of its own kept over it. */
  const resetTo = (next: typeof page) => {
    setPage(next);
    setDraft(settingsOf(next));
    setFailure(undefined);
    setPublishProblem(undefined);
    setVersions(undefined);
  };
  const discardDraft = () => {
    data.bookingPages
      .discard(slug, page.id)
      .then(resetTo, () => toasts.toast({ tone: 'danger', message: publishStrings.discardFailed }));
  };
  const readVersions = () => {
    setVersions(undefined);
    setVersionsFailed(false);
    data.bookingPages.versions(slug, page.id).then(
      (list) =>
        setVersions(
          list.versions.map((one) => ({
            version: one.version,
            isCurrent: one.isCurrent,
            label: publishStrings.versionLabel(one.publishedBy, new Date(one.publishedAt)),
          })),
        ),
      () => setVersionsFailed(true),
    );
  };
  const restore = (version: number) => {
    data.bookingPages.restore(slug, page.id, version).then(
      (next) => {
        resetTo(next);
        toasts.toast({ tone: 'success', message: publishStrings.restored(version) });
      },
      () => toasts.toast({ tone: 'danger', message: publishStrings.restoreFailed }),
    );
  };
  // Restoring over changes not published asks first, in the confirm every ending step uses; over none it just runs.
  const askRestore = (version: number) => {
    if ((page.publication?.changes ?? []).length > 0) setRestoreAsked(version);
    else restore(version);
  };
  const changes = page.publication?.changes ?? [];
  const problemTab = publishProblem?.field === undefined ? undefined : FIELD_TABS[publishProblem.field];

  const save = (patch: Partial<BookingPageSettings>) => {
    if (isSaving || Object.keys(patch).length === 0) return;
    setSaving(true);
    setFailure(undefined);
    sendSettings(patch).then(
      (next) => {
        setSaving(false);
        setPage(next);
        // The server's settings, with the person's own unsaved changes on top; Pause and Resume's status is saved.
        setDraft((current) => draftAfterSave(settingsOf(next), current));
        setChipsError(undefined);
        // Saved is said for the groups' save; Pause and Resume say theirs in a toast with Undo.
        const { status } = patch;
        // The attributes this save filed onto, made just before it (or before an earlier save that failed).
        const made = patch.questions === undefined ? [] : madePending.current;
        if (made.length > 0) {
          madePending.current = [];
          toasts.toast({
            tone: 'success',
            message: questionStrings.createdAttributes(made.length, choices.objectName ?? ''),
            action: { label: questionStrings.undo, onAction: () => undoAttributes(made) },
          });
        }
        if (status === undefined) {
          setJustSaved(true);
          // Publish pressed over unsaved changes: the save landed, so what it saved goes out now.
          if (publishAfterSave.current) publish(next);
          // Preview pressed over unsaved changes: its tab shows them now.
          const opened = previewAfterSave.current;
          previewAfterSave.current = undefined;
          if (opened !== undefined) opened.location.href = pagePreviewHref(slug, next.id);
        } else
          toasts.toast({
            tone: 'success',
            message:
              status === 'live' ? capturesStrings.resumedToast(next.title) : capturesStrings.pausedToast(next.title),
            action: { label: capturesStrings.undo, onAction: () => setLive(status === 'live' ? 'paused' : 'live') },
          });
      },
      (error: unknown) => {
        setSaving(false);
        // A refused save publishes nothing: the bar says why, and Publish waits for the next press. A preview tab
        // opened for it shows what is saved.
        publishAfterSave.current = false;
        const opened = previewAfterSave.current;
        previewAfterSave.current = undefined;
        if (opened !== undefined) opened.location.href = pagePreviewHref(slug, page.id);
        // Pause and Resume aren't part of the save bar's changes: their failure says so in a toast.
        if (patch.status !== undefined) {
          setDraft((current) => ({ ...current, status: page.status }));
          toasts.toast({ tone: 'danger', message: strings.statusFailed(page.title) });
          return;
        }
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        // A refused setting on another tab: show that tab, where the field says what's wrong.
        const refused = field === undefined ? undefined : FIELD_TABS[field];
        if (refused !== undefined) onTabChange(refused);
        setFailure({
          message: isDataError(error) ? error.message : strings.somethingWrong,
          ...(field === undefined ? {} : { field }),
        });
      },
    );
  };
  // The save bar speaks for the groups' changes; the Live switch saves on its own.
  const barError = failure?.message ?? (isWeekDirty ? week.error : undefined);
  const barStatus: SaveBarStatus = !isDirty
    ? justSaved
      ? 'saved'
      : 'hidden'
    : isSaving || week.isSaving
      ? 'saving'
      : barError === undefined
        ? 'unsaved'
        : 'error';
  const location = draft.location;
  // What Location's Select shows: "I'll send a link" is video with no link while no calendar makes one.
  const locationChoice =
    location.type === 'video' && location.link === undefined && makesNoLink ? SEND_LINK : location.type;
  // The Sharing section's address: the saved link (the one that works now), and the /b/ link a Link only page keeps.
  const savedLink = publicBookingUrl(page);
  const bLink = publicBookingUrl({ ...page, isPrivate: true });
  const addressHost = new URL(publicBookingOrigin()).host;
  const isSlugUnsaved = draft.slug !== page.slug;
  // Copy and Open give the saved address, so they wait while the one shown isn't saved yet (a new slug, or a Link
  // only page switched to Public).
  const isAddressUnsaved = isSlugUnsaved || draft.isPrivate !== page.isPrivate;
  // The phone shows the unsaved words and lengths, but its times come from the server: while the hours or limits
  // have unsaved changes it says so.
  const isTimesStale = isWeekDirty || TIME_KEYS.some((key) => key in dirty);
  const isTeam = page.kind === 'round_robin';
  const rotations = useCaptureList(data.rotations.view(slug));
  const rotationList = rotations.status === 'ready' ? rotations.items : [];
  // The people a routing rule may pick: the members of the page's rotations, each once (spec 0043).
  const teamRotations = new Set(page.hosts?.rotations ?? []);
  const teamPool = rotationList
    .filter((rotation) => teamRotations.has(rotation.id))
    .flatMap((rotation) => rotation.members.map((member) => ({ id: member.memberId, name: member.name })))
    .filter((member, at, all) => all.findIndex((each) => each.id === member.id) === at);
  // The tabs: Hosts on a round robin page only. A tab shown that this page doesn't have falls back to Page.
  // Hosts on a round robin page only; Bookings and Insights for whoever may change the page (its own figures).
  const tabs: readonly PageTab[] = PAGE_TABS.filter(
    (each) => (each !== 'hosts' || isTeam) && ((each !== 'bookings' && each !== 'insights') || !isLocked),
  );
  const shown: PageTab = tabs.includes(tab) ? tab : 'page';
  // The tabs whose fields hold an error now: what's marked red on them, and a refusal's field from the server.
  const refusedTab = failure?.field === undefined ? undefined : FIELD_TABS[failure.field];
  const isWhereMissing =
    ((location.type === 'address' || location.type === 'custom') && location.value.trim() === '') ||
    meetingLinkProblem(location) !== undefined;
  const hasError: Readonly<Record<PageTab, boolean>> = {
    page: refusedTab === 'page' || slugProblem(draft.slug) !== undefined,
    meeting:
      refusedTab === 'meeting' ||
      draft.title.trim() === '' ||
      draft.durations.length === 0 ||
      isWhereMissing ||
      chipsError !== undefined ||
      redirectProblem(draft) !== undefined,
    questions: refusedTab === 'questions' || shownProblem !== undefined,
    hosts: refusedTab === 'hosts',
    hours: refusedTab === 'hours' || (isWeekDirty && !week.isValid),
    appearance: refusedTab === 'appearance',
    share: refusedTab === 'share',
    bookings: false,
    insights: false,
  };
  const tabLabel: Readonly<Record<PageTab, string>> = {
    page: strings.page,
    meeting: strings.meeting,
    questions: questionStrings.questions,
    hosts: strings.hostsTab,
    hours: strings.availabilityTab,
    appearance: strings.appearanceTab,
    share: strings.shareTab,
    bookings: activityStrings.bookingsTab,
    insights: activityStrings.insightsTab,
  };
  // What Save can't send yet, said in the bar and by Publish: a field on this tab or another that needs a fix.
  const blockedReason =
    sendable(draft) && (!isWeekDirty || week.isValid)
      ? undefined
      : tabs.some((id) => hasError[id] && id !== shown)
        ? strings.fixTabs(tabs.filter((id) => hasError[id]).map((id) => tabLabel[id]))
        : strings.fixPage;
  /** Saves every unsaved change (the bar's Save and ⌘S); false when nothing of the page's could go. */
  const saveAll = (): boolean => {
    // A question that would break the public page waits, shown on its tab, as a form's publish does.
    if (isPageDirty && dirty.questions !== undefined && questionProblem !== undefined) {
      setProblemAsked(true);
      onTabChange('questions');
      return false;
    }
    setProblemAsked(false);
    if (isPageDirty) saveWithAttributes(dirty);
    if (isWeekDirty) week.save();
    return isPageDirty;
  };
  /** The header's Publish: unsaved changes save first, and the save that lands publishes (as a form's flush does). */
  const publishNow = () => {
    if (isPublishing || isSaving) return;
    if (blockedReason !== undefined) {
      toasts.toast({ tone: 'danger', message: blockedReason });
      return;
    }
    if (isPageDirty) {
      publishAfterSave.current = true;
      if (!saveAll()) publishAfterSave.current = false;
      return;
    }
    if (isWeekDirty) week.save();
    publish();
  };
  const hasUnpublished = changes.length > 0 || isDraftDirty;
  const status = statusOf(page, hasUnpublished);
  const isDraft = isDraftPage(page);
  /** A row's word of help, in a tip beside its label (critic A8: help in tooltips, never a line under it). */
  const tip = (label: string, text: string) => <InfoTip label={label}>{text}</InfoTip>;
  const limitRow = (
    title: string,
    help: { readonly text: string; readonly example: string },
    items: SelectItem[],
    value: string,
    onChange: (id: string | null) => void,
    description?: string,
  ) => (
    <SettingsRow
      title={title}
      // Every select one short column wide, so their edges line up at the end of the form's column.
      control="compact"
      {...(description === undefined ? {} : { description })}
      meta={
        <InfoTip label={title} example={help.example}>
          {help.text}
        </InfoTip>
      }
    >
      <Select
        label={title}
        isLabelHidden
        items={items}
        isReadOnly={readOnly('limits')}
        value={value}
        onChange={onChange}
      />
    </SettingsRow>
  );

  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: (
          <TopBar
            title={draft.title.trim() === '' ? strings.listLabel : draft.title}
            icon="link"
            crumbs={[{ id: 'links', label: strings.linksTitle, href: linksHref(slug) }]}
            // One status, as a form's (the bookings area, 4 November 2026): Draft, Live, Live · edited or Paused.
            meta={
              <>
                <EditorStatus tone={status.tone} text={status.text} />
                {/* Someone else's page (spec 0037, AC-1273): whose it is, beside its status. */}
                {page.ownerName !== undefined && <Badge text={strings.editingFor(page.ownerName)} isWhole />}
                {/* Made from a managed template (AC-1334): where this page's settings come from, beside its status. */}
                {workspaceSets.size > 0 && <Badge text={managedStrings.fromTemplate} isWhole />}
              </>
            }
          >
            <EditorActions
              // A draft has no link guests can use yet: Copy link shows from the first Publish, as a form's does.
              {...(isDraft ? {} : { link: publicBookingUrl(page) })}
              // The page as the draft has it, in a new tab (what guests will see once published).
              preview={
                <Button
                  icon="eye"
                  isLabelCollapsible
                  label={publishStrings.preview}
                  onPress={() => {
                    // The tab opens at once (a popup must come from the press), and loads once the draft is saved.
                    const opened = window.open('', '_blank');
                    if (opened === null) return;
                    opened.opener = null;
                    if (isPageDirty && blockedReason === undefined) {
                      previewAfterSave.current = opened;
                      if (saveAll()) return;
                      previewAfterSave.current = undefined;
                    }
                    opened.location.href = pagePreviewHref(slug, page.id);
                  }}
                >
                  {publishStrings.preview}
                </Button>
              }
              // Publish, the page's one primary, while there is something guests don't see yet.
              {...(!isLocked && (isDraft || hasUnpublished)
                ? {
                    publish: (
                      <Button variant="primary" onPress={publishNow} isPending={isPublishing}>
                        {isPublishing ? publishStrings.publishing : publishStrings.publish}
                      </Button>
                    ),
                  }
                : {})}
              // The rest under ⋯ (the owner, 4 November 2026: Copy link and Preview in the header, nothing more).
              menu={{
                ...(isLocked || isDraft
                  ? {}
                  : { status: page.status === 'live' ? ('live' as const) : ('paused' as const) }),
                onPause: () => setLive('paused'),
                onResume: () => setLive('live'),
                ...(!isLocked && page.ownerName === undefined && page.isEditor !== true
                  ? { onDuplicate: duplicate }
                  : {}),
                // An editor changes the page but never deletes it (AC-1331).
                ...(isLocked || page.isEditor === true ? {} : { onDelete: () => setDeleting(true) }),
                deleteLabel: strings.deletePage,
                triggerRef: moreRef,
                extra: [
                  ...(isDraft || page.status !== 'live'
                    ? []
                    : [
                        {
                          id: 'view',
                          label: publishStrings.viewPage,
                          icon: 'external-link' as const,
                          onAction: () => {
                            globalThis.open(publicBookingUrl(page), '_blank', 'noopener');
                          },
                        },
                      ]),
                  // Its Insights: a tab for whoever changes the page, this for whoever may only see it.
                  ...(isLocked
                    ? [
                        {
                          id: 'insights',
                          label: publishStrings.insights,
                          icon: 'chart-line' as const,
                          onAction: () => {
                            void navigate({ href: insightsHref(slug, { kind: 'booking', page: page.id }) });
                          },
                        },
                      ]
                    : [
                        {
                          id: 'sharing',
                          label: sharingStrings.menuItem,
                          icon: 'users' as const,
                          onAction: () => {
                            setShared(true);
                            setSharing(true);
                          },
                        },
                      ]),
                  ...(isLocked || isDraft
                    ? []
                    : [
                        {
                          id: 'versions',
                          label: publishStrings.versions,
                          icon: 'clock' as const,
                          onAction: () => {
                            setVersionsOpen(true);
                            readVersions();
                          },
                        },
                      ]),
                  // Back to what guests see, once there is something unpublished to lose (it asks first).
                  ...(!isLocked && !isDraft && changes.length > 0
                    ? [
                        {
                          id: 'discard',
                          label: publishStrings.discard,
                          icon: 'undo-2' as const,
                          isDanger: true,
                          onAction: () => setDiscardAsked(true),
                        },
                      ]
                    : []),
                ],
              }}
            />
          </TopBar>
        ),
        body: (
          <>
            <Modal
              title={sharingStrings.title}
              isOpen={isSharing}
              onOpenChange={setSharing}
              actions={<Button slot="close">{sharingStrings.close}</Button>}
            >
              {hasShared && (
                <SharingPanel
                  data={data}
                  slug={slug}
                  resourceType="booking_page"
                  resourceId={page.id}
                  resourceName={page.title}
                  canChange={canShare}
                  people={sharingPeople ?? people}
                  toasts={toasts}
                />
              )}
            </Modal>
            <DeletePageDialog
              page={isDeleting ? page : undefined}
              onClose={() => setDeleting(false)}
              onDelete={(gone) =>
                data.bookingPages.remove(slug, gone.id).then(() => {
                  setDeleting(false);
                  toasts.toast({ tone: 'success', message: strings.deleted(gone.title) });
                  // The page is gone, so its unsaved changes are too: going back to Links never asks.
                  void navigate({ href: linksHref(slug), ignoreBlocker: true });
                })
              }
            />
            <Tabs
              label={strings.tabsLabel}
              variant="bar"
              tabs={tabs.map((id) => ({
                id,
                label: tabLabel[id],
                ...(hasError[id] ? { alert: strings.needsFix } : {}),
              }))}
              selectedKey={shown}
              onSelectionChange={(id) => onTabChange(pageTabOf(id))}
            >
              {/* One panel, the chosen tab's: the layout and its phone preview stay mounted as the tab changes. The forms
                  editor's frame (critic A6, 4 Nov 2026): the phone pinned beside the settings from a laptop's width, in
                  the same two fifths, and each tab's rows held to the forms Settings tab's readable width. */}
              <TabPanel id={shown} variant="fill">
                <PreviewLayout
                  previewShare="wide"
                  bodyLayout="stack"
                  {...(isTimesStale ? { previewNote: <Callout tone="info">{strings.previewSavedTimes}</Callout> } : {})}
                  // The page in a phone beside every settings tab (the owner, 22 Oct 2026), showing the unsaved edits;
                  // Bookings and Insights take the whole width, as a form's Submissions and Analytics do.
                  {...(shown === 'bookings' || shown === 'insights'
                    ? {}
                    : {
                        preview: (
                          <PreviewFrame
                            src={`/b/${page.publicKey}`}
                            title={page.title}
                            // The page's save, or a save of the schedule it books by, draws it again with the new times.
                            version={`${page.updatedAt}|${hours.schedule?.updatedAt ?? ''}`}
                            draft={{
                              title: draft.title,
                              description: draft.description,
                              durations: draft.durations,
                              location: draft.location,
                              // The owner's links as they are now, while the draft shows them (booking socials).
                              ...(showsSocials ? { socials: draft.showSocials ? previewLinks : [] } : {}),
                              defaultView: draft.defaultView,
                            }}
                          />
                        ),
                      })}
                  notices={
                    <>
                      {/* A refused Publish says why where it happened, with the way to the setting to fix. The
                          page's state is the header's status, never a bar here (the bookings area). */}
                      {publishProblem !== undefined && (
                        <Callout
                          tone="danger"
                          title={publishStrings.publishRefused}
                          isAnnounced
                          {...(problemTab === undefined
                            ? {}
                            : {
                                actions: (
                                  <Button onPress={() => onTabChange(problemTab)}>
                                    {publishStrings.goTo(tabLabel[problemTab])}
                                  </Button>
                                ),
                              })}
                        >
                          {publishProblem.message}
                        </Callout>
                      )}
                      <LiveDialog
                        slug={slug}
                        page={liveShown}
                        onClose={() => {
                          setLiveShown(undefined);
                          focusLater(() => moreRef.current);
                        }}
                        onPutOnSite={() => {
                          setLiveShown(undefined);
                          onTabChange('share');
                        }}
                      />
                      <Modal
                        title={publishStrings.versionsTitle}
                        isOpen={isVersionsOpen}
                        onOpenChange={setVersionsOpen}
                        actions={<Button slot="close">{publishStrings.close}</Button>}
                      >
                        {isVersionsFailed ? (
                          <EmptyState tone="error" title={publishStrings.versionsFailed} onRetry={readVersions} />
                        ) : versions === undefined ? (
                          <Skeleton lines={3} />
                        ) : versions.length === 0 ? (
                          <EmptyState title={publishStrings.versionsNone} icon="clock" />
                        ) : (
                          <SettingsStack variant="plain">
                            {versions.map((one) => (
                              <SettingsRow key={one.version} title={one.label}>
                                {one.isCurrent ? (
                                  <Badge text={publishStrings.versionLive} isWhole />
                                ) : (
                                  <Button
                                    onPress={() => {
                                      setVersionsOpen(false);
                                      askRestore(one.version);
                                    }}
                                  >
                                    {publishStrings.restore}
                                  </Button>
                                )}
                              </SettingsRow>
                            ))}
                          </SettingsStack>
                        )}
                      </Modal>
                      <Modal
                        title={publishStrings.discardTitle}
                        variant="confirm"
                        tone="danger"
                        isOpen={isDiscardAsked}
                        onOpenChange={setDiscardAsked}
                        actions={
                          <>
                            <Button slot="close">{publishStrings.discardKeep}</Button>
                            <Button
                              variant="danger-solid"
                              onPress={() => {
                                setDiscardAsked(false);
                                discardDraft();
                              }}
                            >
                              {publishStrings.discardConfirm}
                            </Button>
                          </>
                        }
                      >
                        {publishStrings.discardText}
                      </Modal>
                      <Modal
                        title={publishStrings.restoreTitle(restoreAsked ?? 0)}
                        variant="confirm"
                        tone="danger"
                        isOpen={restoreAsked !== undefined}
                        onOpenChange={(open) => {
                          if (!open) setRestoreAsked(undefined);
                        }}
                        actions={
                          <>
                            <Button slot="close">{publishStrings.restoreKeep}</Button>
                            <Button
                              variant="danger-solid"
                              onPress={() => {
                                if (restoreAsked !== undefined) restore(restoreAsked);
                                setRestoreAsked(undefined);
                              }}
                            >
                              {publishStrings.restoreConfirm}
                            </Button>
                          </>
                        }
                      >
                        {publishStrings.restoreText}
                      </Modal>
                      {isLocked && (
                        <Callout tone="info" title={strings.readOnlyTitle}>
                          {strings.readOnlyText}
                        </Callout>
                      )}
                      {/* What the workspace sets on this page, named once rather than on every field (AC-1334):
                          each of those controls is read only, and a write to one is refused by the server as
                          well. A page level note, so it sits with the other two rather than inside a tab. */}
                      {workspaceSets.size > 0 && (
                        <Callout tone="info" title={managedStrings.fromTemplate}>
                          {managedStrings.setByWorkspaceNote(
                            // In the template editor's order, so the page is described the same way on both sides.
                            MANAGED_PARTS.filter((part) => workspaceSets.has(part)).map(
                              (part) => managedStrings.partName[part],
                            ),
                          )}
                        </Callout>
                      )}
                    </>
                  }
                  footer={
                    <>
                      <SaveBar
                        status={barStatus}
                        {...(isDraftDirty ? { saveLabel: publishStrings.saveDraft } : {})}
                        {...(barError === undefined ? {} : { error: barError })}
                        {...(blockedReason === undefined ? {} : { blockedReason })}
                        onSave={() => {
                          saveAll();
                        }}
                        onDiscard={() => {
                          week.discard();
                          setDraft(saved);
                          setSlugLeft(false);
                          setFailure(undefined);
                          setChipsError(undefined);
                          setJustSaved(false);
                        }}
                        onFocusAway={() => pageHeading(document)?.focus()}
                      />
                      {/* Leaving with unsaved changes asks first, in a Modal; the tabs (`?tab=`) keep the editor and its
                        changes, so moving between them never asks. Closing the tab asks the browser's way. */}
                      <LeaveGuard isDirty={isDirty} searchStays />
                    </>
                  }
                >
                  {shown === 'page' && (
                    // Plain rows under small group headers, as a form's Settings tab (critic A8, 4 Nov 2026): a label on
                    // the left with its help in a tip, the control on the right.
                    <SettingsStack width="readable" rows="inline">
                      <Card title={strings.details}>
                        <SettingsRow title={strings.description} control="field">
                          <Field
                            label={strings.description}
                            isLabelHidden
                            value={draft.description}
                            placeholder={strings.descriptionPlaceholder}
                            isMultiline
                            maxLength={2000}
                            showCounter
                            isReadOnly={readOnly('details')}
                            onChange={(description) => change({ description })}
                          />
                        </SettingsRow>
                      </Card>
                      <Card title={strings.linkSection}>
                        {page.handle !== undefined && !draft.isPrivate && !isWorkspace ? (
                          // The full address, the part after the owner's handle editable (22 Oct 2026); Copy takes the
                          // saved link, so it waits while the address has unsaved changes.
                          <SettingsRow
                            title={strings.address}
                            meta={tip(strings.address, strings.addressHelp)}
                            control="field"
                          >
                            <Field
                              label={strings.address}
                              isLabelHidden
                              value={draft.slug}
                              prefix={`${addressHost}/${page.handle}/`}
                              {...(isSlugUnsaved && page.status === 'live' && !page.isPrivate
                                ? { hint: strings.slugChanging }
                                : {})}
                              maxLength={60}
                              isRequired
                              isReadOnly={readOnly('address')}
                              onChange={(value) => change({ slug: value.toLowerCase().replace(/\s+/g, '-') })}
                              onBlur={() => setSlugLeft(true)}
                              {...(isSlugLeft && slugProblem(draft.slug) !== undefined
                                ? { error: slugProblem(draft.slug) }
                                : failure?.field === 'slug'
                                  ? { error: failure.message }
                                  : {})}
                              // Copy inside the field, at the field's size (one control shape in the row).
                              {...(isDraft
                                ? {}
                                : {
                                    suffix: isAddressUnsaved ? (
                                      <Tooltip content={strings.saveAddressFirst}>
                                        <CopyButton
                                          value={savedLink}
                                          label={strings.copyLink}
                                          variant="ghost"
                                          isIconOnly
                                          isDisabled
                                        />
                                      </Tooltip>
                                    ) : (
                                      <CopyButton
                                        value={savedLink}
                                        label={strings.copyLink}
                                        variant="ghost"
                                        isIconOnly
                                      />
                                    ),
                                  })}
                            />
                          </SettingsRow>
                        ) : (
                          // No handle yet, a workspace link or a Link only page: its /b/ link, read only.
                          <SettingsRow
                            title={strings.address}
                            meta={tip(
                              strings.address,
                              isWorkspace ? strings.workspaceLinkSharing : strings.bAddressHelp,
                            )}
                            control="field"
                          >
                            {isDraft ? (
                              <Field label={strings.address} isLabelHidden value={bLink} isReadOnly />
                            ) : (
                              <Field
                                label={strings.address}
                                isLabelHidden
                                variant="copy"
                                copyLabel={strings.copyLink}
                                value={bLink}
                              />
                            )}
                          </SettingsRow>
                        )}
                        {/* The reader's own handle: on a colleague's page their Profile can't change this address. */}
                        {page.handle === undefined && !draft.isPrivate && isOwnPage && (
                          <SettingsRow title={strings.handleRow}>
                            <ButtonLink href={profileHref(slug)} icon="at-sign">
                              {strings.setHandleShort}
                            </ButtonLink>
                          </SettingsRow>
                        )}
                        {!isWorkspace && (
                          <SettingsRow
                            title={strings.whoCanBook}
                            meta={tip(strings.whoCanBook, strings.linkOnlyHint)}
                            // Switching a public page to Link only retires the address people already have: said
                            // before Save, not found out later by a visitor on Page not found (flow walks, B10).
                            {...(draft.isPrivate && !page.isPrivate ? { description: strings.linkOnlyChanging } : {})}
                          >
                            <SegmentedControl
                              label={strings.whoCanBook}
                              size="compact"
                              segments={[
                                { value: 'public', label: strings.publicPage },
                                { value: 'link', label: strings.linkOnly },
                              ]}
                              value={draft.isPrivate ? 'link' : 'public'}
                              isReadOnly={isLocked}
                              onChange={(value) => {
                                const isPrivate = value === 'link';
                                // Link only hides the address: one it can't save goes back to the saved one, so
                                // nothing hidden blocks Save.
                                change({
                                  isPrivate,
                                  ...(isPrivate && slugProblem(draft.slug) !== undefined ? { slug: page.slug } : {}),
                                });
                              }}
                            />
                          </SettingsRow>
                        )}
                      </Card>
                      {/* Requests waiting for a Confirm (spec 0062, AC-6203): shown while any wait, even once
                          confirm-first is off, and on its own while it is on. */}
                      <RequestsCard
                        data={data}
                        slug={slug}
                        pageId={page.id}
                        isReadOnly={isLocked}
                        isAlwaysShown={page.requiresConfirmation}
                      />
                    </SettingsStack>
                  )}
                  {shown === 'share' && (
                    // Every way to hand the page out, in one place (critic A21, 4 Nov 2026): its link through the
                    // forms' own share part, then the snippet, one-time links, the social links and the link page.
                    <SettingsStack width="readable" rows="inline">
                      <Card title={strings.shareLinkSection}>
                        {isDraft ? (
                          <SettingsRow title={strings.notPublished} description={strings.publishToShare}>
                            {!isLocked && (
                              <Button onPress={publishNow} isPending={isPublishing}>
                                {publishStrings.publish}
                              </Button>
                            )}
                          </SettingsRow>
                        ) : (
                          <ShareBlock name={page.title} link={savedLink} />
                        )}
                      </Card>
                      {/* A few open times as their own link, or as text (the bookings area, 5 November 2026). */}
                      {!isLocked && (
                        <ShareTimesCard
                          data={data}
                          publicKey={page.publicKey}
                          title={page.title}
                          duration={page.durations[0] ?? 30}
                          link={savedLink}
                          isLive={page.status === 'live'}
                          isPaused={page.status === 'paused' && !isDraft}
                        />
                      )}
                      {/* The snippet for someone else's site (spec 0062, L3). */}
                      <EmbedCard
                        script={data.forms.embedUrl()}
                        publicKey={publicBookingPath(page).replace(/^\/(b\/)?/, '')}
                        title={page.title}
                        isLive={page.status === 'live'}
                        quickPicks={BRAND_QUICK_PICKS}
                      />
                      {/* One-time links (AC-6204). */}
                      <OneOffLinksCard
                        data={data}
                        slug={slug}
                        page={page}
                        pageUrl={bLink}
                        isReadOnly={isLocked}
                        onSaved={setPage}
                      />
                      {!isWorkspace && (
                        <SocialsCardSlot
                          data={data}
                          slug={slug}
                          onPreviewLinks={setPreviewLinks}
                          isTeam={page.kind !== 'personal'}
                          isOwner={ownerMember === undefined}
                          isShown={draft.showSocials}
                          isLocked={isLocked}
                          ownerName={page.ownerName}
                          onShownChange={(showSocials) => change({ showSocials })}
                        />
                      )}
                      {page.handle !== undefined && !draft.isPrivate && isOwnPage && (
                        // Where it sits on the owner's link page at /<handle> (spec 0051): a Public page joins it by
                        // itself, and its place and heading are set on the link page, with the rest of the page.
                        <Card title={strings.linkPage}>
                          <SettingsRow
                            title={strings.onLinkPage}
                            meta={tip(strings.onLinkPage, strings.onLinkPageLine)}
                          >
                            <ButtonLink href={linkPageHref(slug)} icon="pencil">
                              {strings.editLinkPage}
                            </ButtonLink>
                          </SettingsRow>
                        </Card>
                      )}
                    </SettingsStack>
                  )}
                  {shown === 'meeting' && (
                    <SettingsStack width="readable" rows="inline">
                      <Card title={strings.meeting}>
                        <SettingsRow title={strings.title} control="field">
                          <Field
                            label={strings.title}
                            isLabelHidden
                            value={draft.title}
                            maxLength={120}
                            isRequired
                            isReadOnly={readOnly('details')}
                            onChange={(title) => change({ title })}
                            {...(draft.title.trim() === '' ? { error: strings.titleRequired } : {})}
                          />
                        </SettingsRow>
                        {readOnly('durations') ? (
                          // Read only: the chosen lengths as words, which a viewer can reach and read.
                          <SettingsRow
                            title={strings.durations}
                            description={draft.durations.map((minutes) => strings.minutesShort(minutes)).join(', ')}
                          />
                        ) : (
                          <SettingsRow
                            title={strings.durations}
                            meta={tip(strings.durations, strings.durationsHelp)}
                            control="field"
                          >
                            <ChoiceChips
                              label={strings.durations}
                              isLabelHidden
                              choices={lengths.map((minutes) => ({
                                id: String(minutes),
                                label: strings.minutesShort(minutes),
                              }))}
                              selected={draft.durations.map(String)}
                              onChange={(ids) => {
                                const durations = lengths.filter((minutes) => ids.includes(String(minutes)));
                                // A fifth is refused here as the server would: the public page shows four.
                                if (durations.length > LENGTHS_MAX) {
                                  setChipsError(strings.lengthsFull);
                                  return;
                                }
                                setChipsError(undefined);
                                change({ durations });
                              }}
                              {...(chipsError === undefined
                                ? draft.durations.length === 0
                                  ? { error: strings.durationRequired }
                                  : {}
                                : { error: chipsError })}
                              end={
                                <Button
                                  ref={customRef}
                                  variant="dashed"
                                  icon="plus"
                                  onPress={() => setAddingLength(true)}
                                >
                                  {strings.durationCustom}
                                </Button>
                              }
                            />
                          </SettingsRow>
                        )}
                        {!readOnly('durations') && (
                          <Popover
                            label={strings.addLength}
                            triggerRef={customRef}
                            isOpen={isAddingLength}
                            onOpenChange={(isOpen) => {
                              setAddingLength(isOpen);
                              if (!isOpen) {
                                setLengthText('');
                                setLengthError(undefined);
                              }
                            }}
                          >
                            <Field
                              label={strings.customMinutes}
                              // With four lengths already, it says so before anything is typed.
                              hint={
                                draft.durations.length >= LENGTHS_MAX ? strings.lengthsFull : strings.customMinutesHint
                              }
                              // The popover opens for this one field: typing starts at once.
                              // eslint-disable-next-line jsx-a11y-x/no-autofocus
                              autoFocus
                              inputMode="numeric"
                              maxLength={3}
                              value={lengthText}
                              onChange={(value) => {
                                setLengthText(value);
                                setLengthError(undefined);
                              }}
                              onSubmit={addLength}
                              suffix={
                                <Button variant="ghost" onPress={addLength} isDisabled={lengthText.trim() === ''}>
                                  {strings.add}
                                </Button>
                              }
                              {...(lengthError === undefined ? {} : { error: lengthError })}
                            />
                          </Popover>
                        )}
                        <SettingsRow title={strings.location} control="field">
                          <Select
                            label={strings.location}
                            isLabelHidden
                            // With no calendar to make a video link (critic B-07, 5 Nov 2026): "I'll send a link" is
                            // video with no link, the page's default, and Video asks for the host's own link below.
                            // With one, Video is the calendar's link, or the host's own when the page keeps one.
                            items={[
                              ...(makesNoLink ? [{ id: SEND_LINK, label: strings.locations.sendLink }] : []),
                              ...LOCATIONS.map((type) => ({ id: type, label: strings.locations[type] })),
                            ]}
                            value={locationChoice}
                            isReadOnly={readOnly('location')}
                            // Only the reconnect case still needs a word: the field below asks for the rest.
                            // A calendar that needs reconnecting makes no link: said under "I'll send a link".
                            {...(locationChoice === SEND_LINK && noLinkReason === 'reconnect'
                              ? { hint: strings.noVideoLinkReconnect }
                              : {})}
                            onChange={(type) => {
                              if (type === SEND_LINK) change({ location: { type: 'video' } });
                              // Video with nothing to make a link: the host's own, asked for right here.
                              if (type === 'video')
                                change({ location: makesNoLink ? { type: 'video', link: '' } : { type: 'video' } });
                              if (type === 'phone') change({ location: { type } });
                              if (type === 'address' || type === 'custom')
                                change({ location: { type, value: 'value' in location ? location.value : '' } });
                            }}
                          />
                        </SettingsRow>
                        {location.type === 'video' && location.link !== undefined && (
                          <SettingsRow
                            title={strings.meetingLink}
                            meta={tip(strings.meetingLink, strings.meetingLinkHelp)}
                            control="field"
                          >
                            <Field
                              label={strings.meetingLink}
                              isLabelHidden
                              type="url"
                              inputMode="url"
                              placeholder={strings.meetingLinkPlaceholder}
                              value={location.link}
                              maxLength={2048}
                              isRequired
                              isReadOnly={readOnly('location')}
                              // Said once the field is left (or Save is tried), not before anything is typed.
                              {...(meetingLinkProblem(location) === undefined || (!isLinkLeft && failure === undefined)
                                ? {}
                                : { error: meetingLinkProblem(location) })}
                              onBlur={() => setLinkLeft(true)}
                              onChange={(link) => change({ location: { type: 'video', link } })}
                            />
                          </SettingsRow>
                        )}
                        {(location.type === 'address' || location.type === 'custom') && (
                          <SettingsRow
                            title={location.type === 'address' ? strings.addressOrRoom : strings.where}
                            control="field"
                          >
                            <Field
                              label={location.type === 'address' ? strings.addressOrRoom : strings.where}
                              isLabelHidden
                              value={location.value}
                              maxLength={500}
                              isRequired
                              isReadOnly={readOnly('location')}
                              {...(location.value.trim() === '' ? { error: strings.whereRequired } : {})}
                              onChange={(value) => change({ location: { type: location.type, value } })}
                            />
                          </SettingsRow>
                        )}
                      </Card>
                      <PageDestination
                        destination={data.calendar.pageDestination(slug, page.id)}
                        calendars={data.calendar.calendars(slug)}
                        isReadOnly={isLocked}
                        {...(page.ownerName === undefined ? {} : { ownerName: page.ownerName })}
                        onChange={(calendarId) => void data.calendar.setPageDestination(slug, page.id, calendarId)}
                        settingsHref={calendarsHref(slug)}
                        canConnect={calendar.status === 'ready' && calendar.enabled}
                      />
                      {/* What happens once a booking is made, on the tab about the meeting itself (the owner, 27
                          October 2026). One row per setting (critic A1: two switches had shared one row). */}
                      <Card title={strings.afterBooking}>
                        <SettingsRow title={strings.addToCrm} meta={tip(strings.addToCrm, strings.addToCrmHelp)}>
                          <Switch
                            label={strings.addToCrm}
                            isLabelHidden
                            isSelected={draft.fileToCrm}
                            isReadOnly={readOnly('on_booking')}
                            onChange={(fileToCrm) => change({ fileToCrm })}
                          />
                        </SettingsRow>
                        {/* Spec 0062, L1: the host confirms each booking first (AC-6203), and where the visitor goes
                            once they have booked (AC-6201). */}
                        <SettingsRow
                          title={strings.confirmFirst}
                          meta={tip(strings.confirmFirst, strings.confirmFirstHint)}
                        >
                          <Switch
                            label={strings.confirmFirst}
                            isLabelHidden
                            isSelected={draft.requiresConfirmation}
                            isReadOnly={isLocked}
                            onChange={(requiresConfirmation) => change({ requiresConfirmation })}
                          />
                        </SettingsRow>
                        <SettingsRow title={strings.thenShow}>
                          <SegmentedControl
                            label={strings.thenShow}
                            size="compact"
                            segments={[
                              { value: 'confirmation', label: strings.afterChoices.confirmation },
                              { value: 'redirect', label: strings.afterChoices.redirect },
                            ]}
                            value={draft.afterBooking}
                            isReadOnly={isLocked}
                            onChange={(value) =>
                              change(
                                value === 'redirect'
                                  ? { afterBooking: 'redirect' }
                                  : { afterBooking: 'confirmation', redirectUrl: null, sendBookingDetails: false },
                              )
                            }
                          />
                        </SettingsRow>
                        {draft.afterBooking === 'redirect' && (
                          <>
                            <SettingsRow title={strings.redirectUrl} control="field">
                              <Field
                                label={strings.redirectUrl}
                                isLabelHidden
                                type="url"
                                inputMode="url"
                                placeholder={strings.redirectPlaceholder}
                                value={draft.redirectUrl ?? ''}
                                isReadOnly={isLocked}
                                {...(isRedirectLeft && redirectProblem(draft) !== undefined
                                  ? { error: redirectProblem(draft) }
                                  : {})}
                                onBlur={() => setRedirectLeft(true)}
                                onChange={(value) => change({ redirectUrl: value })}
                              />
                            </SettingsRow>
                            <SettingsRow
                              title={strings.sendDetails}
                              meta={tip(strings.sendDetails, strings.sendDetailsHint)}
                            >
                              <Switch
                                label={strings.sendDetails}
                                isLabelHidden
                                isSelected={draft.sendBookingDetails}
                                isReadOnly={isLocked}
                                onChange={(sendBookingDetails) => change({ sendBookingDetails })}
                              />
                            </SettingsRow>
                          </>
                        )}
                      </Card>
                    </SettingsStack>
                  )}
                  {shown === 'questions' && (
                    <SettingsStack width="readable" rows="inline">
                      {targets === undefined && !isLocked && (
                        <Callout
                          tone="danger"
                          title={strings.targetsFailedTitle}
                          actions={
                            <Button onPress={() => void readTargets()} isPending={isReadingTargets}>
                              {strings.tryAgain}
                            </Button>
                          }
                        >
                          {strings.targetsFailed}
                        </Callout>
                      )}
                      {brokenAnswersObject !== undefined && (
                        <Callout
                          tone="warning"
                          title={strings.answersObjectBrokenTitle(brokenAnswersObject.pluralName)}
                          {...(canBuild
                            ? {
                                actions: (
                                  <ButtonLink href={objectSettingsHref(slug, brokenAnswersObject)} icon="plus">
                                    {strings.answersObjectAddField}
                                  </ButtonLink>
                                ),
                              }
                            : {})}
                        >
                          {canBuild ? strings.answersObjectBroken : strings.answersObjectBrokenAsk}
                        </Callout>
                      )}
                      {liveObjects.length > 0 && (
                        <Card title={strings.answersObject} isBusy={isMovingAnswers}>
                          <Select
                            savesOnPick
                            label={strings.answersObject}
                            // The card's title already says it (flow walks B6): read, not drawn twice.
                            isLabelHidden
                            items={liveObjects.map((object) => ({
                              id: object.id,
                              label: object.pluralName,
                              icon: object.icon,
                              ...(noEmailMatch?.has(object.id) === true && object.id !== answersObject
                                ? { isDisabled: true, description: strings.answersObjectNoEmail }
                                : {}),
                            }))}
                            optionDescription="below"
                            {...(isAnyUnmatched ? { hint: strings.answersObjectRule } : {})}
                            value={answersObject}
                            isReadOnly={readOnly('on_booking')}
                            isDisabled={isMovingAnswers}
                            onChange={moveAnswers}
                          />
                        </Card>
                      )}
                      {draft.questions.length > 0 && <Callout tone="info">{strings.chatAsks}</Callout>}
                      <QuestionsSection
                        // What every guest is asked before these (critic A7): shown first, locked, so the count and
                        // the list say what a guest really meets.
                        fixed={[
                          {
                            id: 'fixed-name',
                            label: strings.fixedName,
                            typeLabel: questionStrings.answerTypes.short_text,
                            typeIcon: 'type',
                            isRequired: true,
                          },
                          {
                            id: 'fixed-email',
                            label: strings.fixedEmail,
                            typeLabel: questionStrings.answerTypes.email,
                            typeIcon: 'mail',
                            isRequired: true,
                          },
                          {
                            id: 'fixed-notes',
                            label: strings.fixedNotes,
                            typeLabel: questionStrings.answerTypes.long_text,
                            typeIcon: 'file-text',
                          },
                        ]}
                        questions={draft.questions}
                        onChange={(update) => {
                          setJustSaved(false);
                          setDraft((current) => ({ ...current, questions: [...update(current.questions)] }));
                        }}
                        max={QUESTIONS_MAX}
                        holder={questionStrings.pageHolder}
                        keptWith="booking"
                        attributes={choices.items}
                        {...(choices.objectName === undefined ? {} : { objectName: choices.objectName })}
                        isFilingOff={!draft.fileToCrm}
                        // Saved questions keep their keys (answers already stored under them); new ones follow their label.
                        liveIds={liveQuestionIds}
                        newId={() => crypto.randomUUID()}
                        toasts={toasts}
                        canCreate={canBuild}
                        isReadOnly={readOnly('questions')}
                        {...(shownProblem === undefined ? {} : { problem: shownProblem })}
                      />
                    </SettingsStack>
                  )}
                  {isTeam && shown === 'hosts' && (
                    <SettingsStack width="readable" rows="inline">
                      <Callout tone="info">{publishStrings.goesLive}</Callout>
                      <HostsCard
                        data={data}
                        slug={slug}
                        page={page}
                        people={people}
                        rotations={rotationList}
                        isLocked={isLocked}
                        rescheduleHost={draft.rescheduleHost}
                        onRescheduleChange={(rescheduleHost) => change({ rescheduleHost })}
                        onSaved={(saved) => {
                          setPage(saved);
                          onNotice?.(rotationStrings.hostsSaved);
                        }}
                      />
                      <RulesCard
                        data={data}
                        slug={slug}
                        surface={{ kind: 'page', pageId: page.id, pool: teamPool }}
                        {...(isLocked ? {} : { report: { kind: 'booking_page' as const, pageId: page.id } })}
                        rules={page.routing?.rules ?? []}
                        facts={pageFacts(page.questions, recordFields)}
                        factLabel={routingStrings.questionOrField}
                        emptyFacts={routingStrings.noFields}
                        description={routingStrings.pageRoutingLine(page.routing?.rules.length ?? 0)}
                        isReadOnly={isLocked}
                        nameOf={(memberId) => people.find((person) => person.id === memberId)?.name ?? ''}
                        onRulesChange={async (rules) => {
                          const saved = await data.bookingPages.update(
                            slug,
                            page.id,
                            {},
                            { routing: { rules: [...rules] } },
                          );
                          setPage(saved);
                          onNotice?.(routingStrings.saved);
                        }}
                      />
                      <FormOnlyCard
                        data={data}
                        slug={slug}
                        page={page}
                        isLocked={isLocked}
                        onSaved={(saved) => {
                          setPage(saved);
                          onNotice?.(routingStrings.saved);
                        }}
                      />
                    </SettingsStack>
                  )}
                  {shown === 'appearance' && (
                    // The look in a tab of its own (T21): how the page opens, and the brand it wears.
                    <PageAppearance
                      data={data}
                      slug={slug}
                      opensIn={draft.defaultView}
                      isLocked={isLocked}
                      onOpensIn={(defaultView) => change({ defaultView })}
                      brandHref={brandSettingsHref(slug)}
                      opensInMeta={tip(strings.opensIn, strings.opensInHelp)}
                    />
                  )}
                  {shown === 'hours' && (
                    // Hours and Limits as one Availability tab (critic A6, 4 Nov 2026), the forms Settings width.
                    <SettingsStack width="readable" rows="inline">
                      {/* In reading order (the owner, 22 Oct 2026): the schedule, its week, its days off, then
                          reserved time and conflicts, each a section with its heading. */}
                      {isTeam ? (
                        <Card title={strings.weeklyHours} description={rotationStrings.hoursMembers} />
                      ) : (
                        <Card
                          title={scheduleStrings.schedule}
                          actions={
                            <>
                              {/* A schedule's week and days off are shared by every page that books by it (AC-6813). */}
                              <InfoTip label={scheduleStrings.schedule}>{publishStrings.hoursLive}</InfoTip>
                              <ButtonLink href={hours.manageHref} variant="ghost" size="sm" icon="settings">
                                {strings.manageSchedules}
                              </ButtonLink>
                            </>
                          }
                        >
                          <Select
                            label={scheduleStrings.schedule}
                            isLabelHidden
                            items={hours.items}
                            value={draft.scheduleId ?? 'default'}
                            isReadOnly={readOnly('hours') || hours.items.length === 0 || isWeekDirty}
                            {...(hours.items.length === 0
                              ? { readOnlyReason: strings.followOwnerHint }
                              : isWeekDirty
                                ? { readOnlyReason: strings.saveHoursFirst }
                                : {})}
                            {...(hours.schedule !== undefined && hours.schedule.pages.length > 1
                              ? { hint: strings.sharedSchedule(hours.schedule.name, hours.schedule.pages.length) }
                              : {})}
                            onChange={(id) => {
                              if (id !== null) change({ scheduleId: id === 'default' ? null : id });
                            }}
                          />
                        </Card>
                      )}
                      {!isTeam &&
                        (hours.status === 'loading' ? (
                          // The week's card in its loading shape, so the editor lands where it stood.
                          <WeekCardPending />
                        ) : hours.schedule === undefined ? (
                          // The owner's schedules can't be read here: the week the page books by, read only, saying why.
                          <Card
                            title={strings.weeklyHours}
                            description={hours.status === 'failed' ? strings.hoursUnreadable : strings.followOwnerHint}
                          >
                            <DescriptionList
                              layout="compact"
                              items={[
                                {
                                  id: 'zone',
                                  term: strings.timeZone,
                                  description: zoneDisplay(hours.availability.timeZone, openedAt),
                                },
                                ...weekGroups(hours.availability, locale).map((group) => ({
                                  id: group.days,
                                  term: group.days,
                                  description: group.hours,
                                })),
                              ]}
                            />
                          </Card>
                        ) : (
                          <>
                            <WeekCard availability={week.shown} onChange={changeWeek} isReadOnly={readOnly('hours')} />
                            <DaysOff
                              availability={week.shown}
                              onChange={(next) => changeWeek(() => next)}
                              isReadOnly={readOnly('hours')}
                            />
                          </>
                        ))}
                      {draft.isPrivate && (
                        <Card
                          title={strings.reservedTime}
                          description={strings.reservedTimeLine}
                          actions={
                            <ButtonLink
                              href={bookingsTabHref(slug, 'calendar')}
                              variant="ghost"
                              size="sm"
                              icon="settings"
                            >
                              {strings.manage}
                            </ButtonLink>
                          }
                        />
                      )}
                      <PageConflicts
                        destination={data.calendar.pageDestination(slug, page.id)}
                        calendars={data.calendar.calendars(slug)}
                        settingsHref={calendarsHref(slug)}
                        canConnect={calendar.status === 'ready' && calendar.enabled}
                      />

                      <Card title={strings.limitGroups.buffers}>
                        {limitRow(
                          strings.bufferBefore,
                          strings.limitHelp.before,
                          BUFFERS,
                          String(draft.bufferBefore),
                          (id) => change({ bufferBefore: Number(id ?? 0) }),
                        )}
                        {limitRow(
                          strings.bufferAfter,
                          strings.limitHelp.after,
                          BUFFERS,
                          String(draft.bufferAfter),
                          (id) => change({ bufferAfter: Number(id ?? 0) }),
                        )}
                      </Card>
                      <Card title={strings.limitGroups.window}>
                        {limitRow(
                          strings.notice,
                          strings.limitHelp.notice,
                          NOTICE,
                          String(draft.minNoticeMinutes),
                          (id) => change({ minNoticeMinutes: Number(id ?? 0) }),
                          draft.isPrivate ? strings.noticeIgnored : undefined,
                        )}
                        {limitRow(strings.window, strings.limitHelp.ahead, WINDOW, String(draft.windowDays), (id) =>
                          change({ windowDays: Number(id ?? 60) }),
                        )}
                      </Card>
                      <Card title={strings.limitGroups.changes}>
                        {limitRow(
                          strings.cancelCutoff,
                          strings.limitHelp.cancelCutoff,
                          CUTOFF,
                          String(draft.cancelCutoffMinutes),
                          (id) => change({ cancelCutoffMinutes: Number(id ?? 0) }),
                        )}
                        {limitRow(
                          strings.moveCutoff,
                          strings.limitHelp.moveCutoff,
                          CUTOFF,
                          String(draft.moveCutoffMinutes),
                          (id) => change({ moveCutoffMinutes: Number(id ?? 0) }),
                        )}
                      </Card>
                      <Card title={strings.limitGroups.pace}>
                        {limitRow(
                          strings.dailyLimit,
                          strings.limitHelp.daily,
                          DAILY,
                          draft.dailyLimit === null ? 'none' : String(draft.dailyLimit),
                          (id) => change({ dailyLimit: id === null || id === 'none' ? null : Number(id) }),
                        )}
                        {limitRow(
                          strings.step,
                          strings.limitHelp.step,
                          STEPS,
                          draft.slotStep === null ? 'duration' : String(draft.slotStep),
                          (id) => change({ slotStep: id === '15' ? 15 : id === '30' ? 30 : id === '60' ? 60 : null }),
                        )}
                      </Card>
                    </SettingsStack>
                  )}
                  {shown === 'bookings' && <PageBookingsTab data={data} slug={slug} pageId={page.id} />}
                  {shown === 'insights' && <PageInsightsTab data={data} slug={slug} pageId={page.id} />}
                </PreviewLayout>
              </TabPanel>
            </Tabs>
          </>
        ),
      }}
    />
  );
}

/**
 * The first Publish's moment (the bookings area, 4 November 2026): "<page> is live", its link through the forms' own
 * share part (`ShareBlock`: the link with Copy and Open, its QR code, Email, WhatsApp and the share sheet), a quiet way
 * to the embed, and Done. The same anatomy as a form's live dialog (`ReadyDialog` in forms/PublishDialog.tsx), which
 * takes a form, so it is drawn here from the same parts rather than forked.
 */
function LiveDialog({
  slug,
  page,
  onClose,
  onPutOnSite,
}: {
  readonly slug: string;
  readonly page: BookingPageView | undefined;
  readonly onClose: () => void;
  readonly onPutOnSite: () => void;
}) {
  // The last page stays while the Modal plays its exit.
  const [last, setLast] = useState(page);
  if (page !== undefined && page !== last) setLast(page);
  const live = page ?? last;
  if (live === undefined) return null;
  return (
    <Modal
      title={publishStrings.liveTitle(live.title)}
      variant="form"
      isOpen={page !== undefined}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      actions={
        // Copy link is the dialog's one primary; Done only closes it, and focus starts there, as a form's does.
        // eslint-disable-next-line jsx-a11y-x/no-autofocus
        <Button key="done" slot="close" autoFocus>
          {publishStrings.done}
        </Button>
      }
    >
      <ShareBlock
        name={live.title}
        link={publicBookingUrl(live)}
        onward={{ label: publishStrings.putOnSite, href: pageEditorHref(slug, live.id, 'share'), onPress: onPutOnSite }}
      />
    </Modal>
  );
}

/** Props for PageEditorPending. */
export interface PageEditorPendingProps {
  /** The tab the editor will open on, from `?tab=`. */
  readonly tab: PageTab;
  /** The editor's notices, when already known (the calendar note). */
  readonly notices?: ReactNode;
}

/**
 * Each tab's sections as its loading state draws them, by title: the ones a page shows there whatever it holds, so the
 * editor lands where they stood (the owner, 20 Oct 2026). Profile and Reserved time wait for the page, which says
 * whether it has them; Hours draws a one on one page's, the usual kind.
 */
const PENDING_SECTIONS: Readonly<Record<PageTab, readonly string[]>> = {
  page: [strings.details, strings.linkSection],
  meeting: [strings.meeting, strings.calendarSection, strings.afterBooking],
  questions: [questionStrings.questions],
  hosts: [rotationStrings.hosts, routingStrings.routing],
  hours: [scheduleStrings.schedule, strings.weeklyHours, strings.daysOff, strings.limitGroups.buffers],
  appearance: [strings.layoutSection, capturesStrings.brandTitle],
  share: [strings.shareLinkSection, socialsStrings.title],
  bookings: [activityStrings.upcoming],
  insights: [activityStrings.insightsTab],
};

/**
 * The editor while its page loads: the publish bar's strip, the tabs where the editor's will stand, and the chosen
 * one's sections, titled and busy, with skeleton fields. Hosts waits for the page, since only a round robin page has it.
 */
export function PageEditorPending({ tab, notices }: PageEditorPendingProps) {
  // Hosts only when it is the tab asked for (a round robin page's); the page says whether it has it.
  const tabs: readonly PageTab[] = PAGE_TABS.filter((each) => each !== 'hosts' || tab === 'hosts');
  const shown = tab;
  const label: Readonly<Record<PageTab, string>> = {
    page: strings.page,
    meeting: strings.meeting,
    questions: questionStrings.questions,
    hosts: strings.hostsTab,
    hours: strings.availabilityTab,
    appearance: strings.appearanceTab,
    share: strings.shareTab,
    bookings: activityStrings.bookingsTab,
    insights: activityStrings.insightsTab,
  };
  return (
    <WorkspacePage
      currentPage="captures"
      page={{
        topBar: <TopBar title={strings.listLabel} icon="link" isLoading />,
        body: (
          <Tabs
            label={strings.tabsLabel}
            variant="bar"
            // Only the shown tab while it loads: the others wait for the page.
            tabs={tabs.map((id) => ({ id, label: label[id], ...(id === shown ? {} : { isDisabled: true }) }))}
            selectedKey={shown}
          >
            <TabPanel id={shown} variant="fill">
              <PreviewLayout
                previewShare="wide"
                bodyLayout="stack"
                {...(shown === 'bookings' || shown === 'insights' ? {} : { preview: <Skeleton shape="block" /> })}
                {...(notices === undefined ? {} : { notices })}
              >
                <SettingsStack width="readable" rows="inline">
                  {PENDING_SECTIONS[shown].map((title) => (
                    <Card key={title} title={title} isBusy>
                      <Skeleton lines={3} />
                    </Card>
                  ))}
                </SettingsStack>
              </PreviewLayout>
            </TabPanel>
          </Tabs>
        ),
      }}
    />
  );
}

/**
 * The Hours tab's choices and the chosen schedule (spec 0035, AC-965): "Default schedule (<name>)" first, then each
 * of the owner's stored schedules by name. A page naming a schedule that is gone books by the default, as the server
 * reads it. Until the owner's schedules load (or when they can't be read), there is no schedule to edit and the
 * page's own answer stands in: the hours it books by now.
 */
function useHours(
  view: SchedulesView | undefined,
  scheduleId: string | null,
  page: BookingPageView,
  slug: string,
  ownerMember: string | undefined,
) {
  const read = useSchedules(view);
  // Availability, on the owner's schedules (an admin's view of a colleague's page opens theirs, `?member=`).
  const manageHref = availabilityHref(slug, ownerMember);
  if (view === undefined || read.status !== 'ready') {
    // None to read (a reader who may not read them), still on their way, or a read that failed.
    const status = view === undefined ? 'none' : read.status === 'loading' ? 'loading' : 'failed';
    return { status, items: [], availability: page.availability, schedule: undefined, manageHref } as const;
  }
  const state = read.schedules;
  const fallback = state.find((each) => each.isDefault);
  const named = scheduleId === null ? undefined : state.find((each) => each.id === scheduleId);
  const chosen = named ?? fallback;
  return {
    status: 'ready',
    items: scheduleChoices(state, scheduleId),
    availability: chosen?.availability ?? page.availability,
    schedule: chosen,
    manageHref,
  };
}

/** What the week's draft holds while there is no schedule to edit: the page's own hours, never saved. */
const standIn = (page: BookingPageView): ScheduleView => ({
  id: null,
  memberId: page.ownerMemberId,
  name: '',
  isDefault: true,
  availability: page.availability,
  pages: [],
  updatedAt: null,
});
