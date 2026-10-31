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
  isDataError,
  type BookingPageSettings,
  type BookingPageView,
  type DataLayer,
  type FormTargetChoices,
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
  Field,
  FieldGroup,
  InfoTip,
  Link,
  Modal,
  PreviewFrame,
  PreviewLayout,
  Popover,
  Radio,
  RadioGroup,
  SaveBar,
  SegmentedControl,
  Select,
  SettingsRow,
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
import { objectSettingsHref, profileHref } from '../settings/nav.ts';
import { lengthChoices, lengthOf, LENGTHS_MAX } from './durations.ts';
import { CalendarNote, readDismissed, writeDismissed } from './CalendarNote.tsx';
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
  pageTabOf,
  publicBookingOrigin,
  publicBookingUrl,
  type PageTab,
} from './links.ts';
import { scheduleStrings } from './schedule-strings.ts';
import { strings as rotationStrings } from './rotation-strings.ts';
import { SharingPanel } from './SharingPanel.tsx';
import { sharingStrings } from './sharing-strings.ts';
import { scheduleChoices } from './schedules.ts';
import { strings } from './strings.ts';
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

const minutesItems = (values: readonly number[]): SelectItem[] =>
  values.map((value) => ({ id: String(value), label: value === 0 ? strings.none : strings.minutes(value) }));
const BUFFERS = minutesItems([0, 5, 10, 15, 20, 30, 45, 60]);
const NOTICE: SelectItem[] = [
  { id: '0', label: strings.none },
  ...[15, 30].map((value) => ({ id: String(value), label: strings.minutes(value) })),
  ...[1, 2, 4, 12].map((value) => ({ id: String(value * 60), label: strings.hoursCount(value) })),
  ...[1, 2, 3, 7, 14].map((value) => ({ id: String(value * 1440), label: strings.days(value) })),
];
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

/** The tab each setting sits on, for a refusal that names its field. */
const FIELD_TABS: Readonly<Record<string, PageTab>> = {
  slug: 'page',
  profileSection: 'page',
  profilePosition: 'page',
  description: 'page',
  isPrivate: 'page',
  showSocials: 'page',
  defaultView: 'page',
  questions: 'questions',
  answersObjectId: 'questions',
  fileToCrm: 'meeting',
  title: 'meeting',
  durations: 'meeting',
  location: 'meeting',
  rescheduleHost: 'hosts',
  scheduleId: 'hours',
  bufferBefore: 'limits',
  bufferAfter: 'limits',
  minNoticeMinutes: 'limits',
  windowDays: 'limits',
  dailyLimit: 'limits',
  slotStep: 'limits',
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
});

/** Why a slug can't be sent, in plain words, or undefined when it can. */
function slugProblem(value: string): string | undefined {
  if (value === '') return strings.slugRequired;
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 60 ? undefined : strings.slugInvalid;
}

/** Whether a draft is fine to send: the server would refuse it otherwise. */
function sendable(draft: BookingPageSettings): boolean {
  return (
    draft.title.trim() !== '' &&
    slugProblem(draft.slug) === undefined &&
    draft.durations.length > 0 &&
    (draft.location.type === 'video' || draft.location.type === 'phone' || draft.location.value.trim() !== '')
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
  // The link page is the viewer's own: only the page's owner places it there (an admin editing a teammate's page doesn't).
  // A workspace link is nobody's own (30 Oct 2026): no handle, no profile, no social links, only its /b/ link.
  const isWorkspace = page.scope === 'workspace';
  const isOwnPage = ownerMember === undefined && !isWorkspace;
  const saved = settingsOf(page);
  const [draft, setDraft] = useState(saved);
  // The address's shape is said once the person leaves the field, not at every key.
  const [isSlugLeft, setSlugLeft] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ readonly message: string; readonly field?: string } | undefined>(undefined);
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
  // The calendar note shows only to someone with no calendar connected yet (their own connections, spec 0024).
  const calendar = useCalendar(data.calendar.view(slug));
  // The route primes the list, so the note is in the first paint's layout and never pushes the cards down.
  const hasNoCalendar = calendar.status === 'ready' && calendar.connections.length === 0;
  const [isNoteDismissed, setNoteDismissed] = useState(() => readDismissed(slug));
  // Video with no live calendar makes no link, and Location says so (Q57, Q77): `noVideoLinkReason` says when.
  const destination = usePageDestination(data.calendar.pageDestination(slug, page.id));
  const noLinkReason = noVideoLinkReason({
    kind: page.kind,
    isOwner: destination.status === 'ready' ? destination.destination.isOwner : undefined,
    connections: calendar.status === 'ready' ? calendar.connections.map((connection) => connection.status) : undefined,
  });
  const noLinkHint =
    noLinkReason === 'reconnect'
      ? strings.noVideoLinkReconnect
      : noLinkReason === 'none'
        ? calendar.status === 'ready' && !calendar.enabled
          ? strings.noVideoLinkNoSync
          : strings.noVideoLink
        : undefined;
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
  // A required question turns Book by chat off for the page (owner, 26 Oct 2026): chat asks no questions.
  const isChatOff = draft.questions.some((question) => question.required);
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
    data.bookingPages.update(slug, page.id, { questions: unfile(savedQuestions.current) }).then(
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

  const save = (patch: Partial<BookingPageSettings>) => {
    if (isSaving || Object.keys(patch).length === 0) return;
    setSaving(true);
    setFailure(undefined);
    data.bookingPages.update(slug, page.id, patch).then(
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
        if (status === undefined) setJustSaved(true);
        else
          toasts.toast({
            tone: 'success',
            message:
              status === 'live' ? capturesStrings.resumedToast(next.title) : capturesStrings.pausedToast(next.title),
            action: { label: capturesStrings.undo, onAction: () => setLive(status === 'live' ? 'paused' : 'live') },
          });
      },
      (error: unknown) => {
        setSaving(false);
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
  // Open, as the header's View page: a real link to a new tab, waiting while the address shown isn't saved.
  const openButton = (href: string, isWaiting: boolean) => {
    const button = (
      <ButtonLink href={href} isExternal icon="external-link" isDisabled={isWaiting}>
        {strings.openLink}
      </ButtonLink>
    );
    return isWaiting ? <Tooltip content={strings.saveAddressFirst}>{button}</Tooltip> : button;
  };
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
  const tabs: readonly PageTab[] = PAGE_TABS.filter((each) => each !== 'hosts' || isTeam);
  const shown: PageTab = tabs.includes(tab) ? tab : 'page';
  // The tabs whose fields hold an error now: what's marked red on them, and a refusal's field from the server.
  const refusedTab = failure?.field === undefined ? undefined : FIELD_TABS[failure.field];
  const isWhereMissing = (location.type === 'address' || location.type === 'custom') && location.value.trim() === '';
  const hasError: Readonly<Record<PageTab, boolean>> = {
    page: refusedTab === 'page' || slugProblem(draft.slug) !== undefined,
    meeting:
      refusedTab === 'meeting' ||
      draft.title.trim() === '' ||
      draft.durations.length === 0 ||
      isWhereMissing ||
      chipsError !== undefined,
    questions: refusedTab === 'questions' || shownProblem !== undefined,
    hosts: refusedTab === 'hosts',
    hours: refusedTab === 'hours' || (isWeekDirty && !week.isValid),
    limits: refusedTab === 'limits',
  };
  const tabLabel: Readonly<Record<PageTab, string>> = {
    page: strings.page,
    meeting: strings.meeting,
    questions: questionStrings.questions,
    hosts: strings.hostsTab,
    hours: strings.hours,
    limits: strings.limits,
  };
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
      <Select label={title} isLabelHidden items={items} isReadOnly={isLocked} value={value} onChange={onChange} />
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
            // Live or Paused, as a form's; the ⋯ menu's Pause or Resume changes it.
            meta={
              <>
                <EditorStatus
                  tone={page.status === 'live' ? 'live' : 'paused'}
                  text={page.status === 'live' ? strings.statusLive : strings.statusOff}
                />
                {/* Someone else's page (spec 0037, AC-1273): whose it is, beside its status. */}
                {page.ownerName !== undefined && <Badge text={strings.editingFor(page.ownerName)} isWhole />}
              </>
            }
          >
            <EditorActions
              link={publicBookingUrl(page)}
              viewHref={publicBookingUrl(page)}
              {...(isLocked
                ? {}
                : {
                    menu: {
                      status: page.status === 'live' ? ('live' as const) : ('paused' as const),
                      onPause: () => setLive('paused'),
                      onResume: () => setLive('live'),
                      ...(page.ownerName === undefined && page.isEditor !== true ? { onDuplicate: duplicate } : {}),
                      // An editor changes the page but never deletes it (AC-1331).
                      ...(page.isEditor === true ? {} : { onDelete: () => setDeleting(true) }),
                      deleteLabel: strings.deletePage,
                      extra: [
                        {
                          id: 'sharing',
                          label: sharingStrings.menuItem,
                          icon: 'users' as const,
                          onAction: () => {
                            setShared(true);
                            setSharing(true);
                          },
                        },
                      ],
                    },
                  })}
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
              {/* One panel, the chosen tab's: the layout and its phone preview stay mounted as the tab changes. Each tab's
                  sections fill the width beside the phone (the owner, 23 Oct 2026). */}
              <TabPanel id={shown} variant="fill">
                <PreviewLayout
                  {...(isTimesStale ? { previewNote: <Callout tone="info">{strings.previewSavedTimes}</Callout> } : {})}
                  // The page in a phone beside every tab (the owner, 22 Oct 2026), showing the unsaved edits.
                  preview={
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
                  }
                  notices={
                    <>
                      {page.status === 'paused' && <Callout tone="info">{strings.pausedNote}</Callout>}
                      {isLocked && (
                        <Callout tone="info" title={strings.readOnlyTitle}>
                          {strings.readOnlyText}
                        </Callout>
                      )}
                      {/* The note is about the reader's own calendar: not on a colleague's page. */}
                      {hasNoCalendar && !isNoteDismissed && page.ownerName === undefined && (
                        <CalendarNote
                          slug={slug}
                          canConnect={calendar.enabled}
                          onDismiss={() => {
                            setNoteDismissed(true);
                            writeDismissed(slug);
                          }}
                        />
                      )}
                    </>
                  }
                  footer={
                    <>
                      <SaveBar
                        status={barStatus}
                        {...(barError === undefined ? {} : { error: barError })}
                        {...(sendable(draft) && (!isWeekDirty || week.isValid)
                          ? {}
                          : {
                              blockedReason: tabs.some((id) => hasError[id] && id !== shown)
                                ? strings.fixTabs(tabs.filter((id) => hasError[id]).map((id) => tabLabel[id]))
                                : strings.fixPage,
                            })}
                        onSave={() => {
                          // A question that would break the public page waits, shown on its tab, as a form's publish does.
                          if (isPageDirty && dirty.questions !== undefined && questionProblem !== undefined) {
                            setProblemAsked(true);
                            onTabChange('questions');
                            return;
                          }
                          setProblemAsked(false);
                          if (isPageDirty) saveWithAttributes(dirty);
                          if (isWeekDirty) week.save();
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
                    <>
                      <Card title={strings.details}>
                        <Field
                          label={strings.description}
                          value={draft.description}
                          placeholder={strings.descriptionPlaceholder}
                          isMultiline
                          maxLength={2000}
                          showCounter
                          isReadOnly={isLocked}
                          onChange={(description) => change({ description })}
                        />
                        {/* The view the page opens in (the owner, 25 Oct 2026): the host's default, which a
                          visitor's own remembered choice still wins over. A FieldGroup, as Who can book is, so the
                          line under it is read with the choices; the phone beside this switches to the view at once. */}
                        <FieldGroup label={strings.opensIn}>
                          <RadioGroup
                            label={strings.opensIn}
                            isLabelHidden
                            orientation="horizontal"
                            value={draft.defaultView}
                            isReadOnly={isLocked}
                            onChange={(value) => {
                              if (value === 'month' || value === 'list' || value === 'chat') {
                                change({ defaultView: value });
                              }
                            }}
                          >
                            <Radio value="month">{strings.opensInViews.month}</Radio>
                            <Radio value="list">{strings.opensInViews.list}</Radio>
                            <Radio
                              value="chat"
                              isDisabled={isChatOff}
                              {...(isChatOff ? { description: strings.chatOffRequired } : {})}
                            >
                              {strings.opensInViews.chat}
                            </Radio>
                          </RadioGroup>
                        </FieldGroup>
                      </Card>
                      <Card
                        title={strings.sharing}
                        {...(isWorkspace ? { description: strings.workspaceLinkSharing } : {})}
                      >
                        {page.handle !== undefined && !draft.isPrivate && !isWorkspace ? (
                          // The full address, the part after the owner's handle editable (22 Oct 2026); Copy and
                          // Open take the saved link, so they wait while the address has unsaved changes.
                          <Field
                            label={strings.address}
                            value={draft.slug}
                            prefix={`${addressHost}/${page.handle}/`}
                            {...(isSlugUnsaved && page.status === 'live' && !page.isPrivate
                              ? { hint: strings.slugChanging }
                              : {})}
                            maxLength={60}
                            isRequired
                            isReadOnly={isLocked}
                            onChange={(value) => change({ slug: value.toLowerCase().replace(/\s+/g, '-') })}
                            onBlur={() => setSlugLeft(true)}
                            {...(isSlugLeft && slugProblem(draft.slug) !== undefined
                              ? { error: slugProblem(draft.slug) }
                              : failure?.field === 'slug'
                                ? { error: failure.message }
                                : {})}
                            suffix={
                              isAddressUnsaved ? (
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
                                <CopyButton value={savedLink} label={strings.copyLink} variant="ghost" isIconOnly />
                              )
                            }
                            after={openButton(savedLink, isAddressUnsaved)}
                          />
                        ) : (
                          // No handle yet, or a Link only page: its /b/ link, which only those who have it can use.
                          <Field
                            label={strings.address}
                            variant="copy"
                            copyLabel={strings.copyLink}
                            value={bLink}
                            after={openButton(bLink, false)}
                          />
                        )}
                        {/* The reader's own handle: on a colleague's page their Profile can't change this address. */}
                        {page.handle === undefined && !draft.isPrivate && isOwnPage && (
                          <Link href={profileHref(slug)}>{strings.setHandle}</Link>
                        )}
                        {!isWorkspace && (
                          <FieldGroup
                            label={strings.whoCanBook}
                            // Switching a public page to Link only retires the address people already have: said
                            // before Save, not found out later by a visitor on Page not found (flow walks, B10).
                            {...(draft.isPrivate
                              ? { hint: page.isPrivate ? strings.linkOnlyHint : strings.linkOnlyChanging }
                              : {})}
                          >
                            <SegmentedControl
                              label={strings.whoCanBook}
                              segments={[
                                { value: 'public', label: strings.publicPage },
                                { value: 'link', label: strings.linkOnly },
                              ]}
                              value={draft.isPrivate ? 'link' : 'public'}
                              isReadOnly={isLocked}
                              onChange={(value) => {
                                const isPrivate = value === 'link';
                                // Link only hides the address: one it can't save goes back to the saved one, so nothing
                                // hidden blocks Save.
                                change({
                                  isPrivate,
                                  ...(isPrivate && slugProblem(draft.slug) !== undefined ? { slug: page.slug } : {}),
                                });
                              }}
                            />
                          </FieldGroup>
                        )}
                      </Card>
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
                          <SettingsRow title={strings.onLinkPage} description={strings.onLinkPageLine}>
                            <ButtonLink href={linkPageHref(slug)} icon="pencil">
                              {strings.editLinkPage}
                            </ButtonLink>
                          </SettingsRow>
                        </Card>
                      )}
                    </>
                  )}
                  {shown === 'meeting' && (
                    <>
                      <Card title={strings.meeting}>
                        <Field
                          label={strings.title}
                          value={draft.title}
                          maxLength={120}
                          isRequired
                          isReadOnly={isLocked}
                          onChange={(title) => change({ title })}
                          {...(draft.title.trim() === '' ? { error: strings.titleRequired } : {})}
                        />
                        {isLocked ? (
                          // Read only: the chosen lengths as text, which a viewer can reach and read; disabled chips can't be.
                          <DescriptionList
                            items={[
                              {
                                term: strings.durations,
                                description: draft.durations.map((minutes) => strings.minutesShort(minutes)).join(', '),
                              },
                            ]}
                          />
                        ) : (
                          <ChoiceChips
                            label={strings.durations}
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
                        )}
                        {!isLocked && (
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
                      </Card>
                      <Card title={strings.location}>
                        <Select
                          label={strings.location}
                          isLabelHidden
                          items={LOCATIONS.map((type) => ({ id: type, label: strings.locations[type] }))}
                          value={location.type}
                          isReadOnly={isLocked}
                          {...(location.type === 'video' && noLinkHint !== undefined ? { hint: noLinkHint } : {})}
                          onChange={(type) => {
                            if (type === 'video' || type === 'phone') change({ location: { type } });
                            if (type === 'address' || type === 'custom')
                              change({ location: { type, value: 'value' in location ? location.value : '' } });
                          }}
                        />
                        {(location.type === 'address' || location.type === 'custom') && (
                          <Field
                            label={location.type === 'address' ? strings.addressOrRoom : strings.where}
                            value={location.value}
                            maxLength={500}
                            isRequired
                            isReadOnly={isLocked}
                            {...(location.value.trim() === '' ? { error: strings.whereRequired } : {})}
                            onChange={(value) => change({ location: { type: location.type, value } })}
                          />
                        )}
                      </Card>
                      <PageDestination
                        destination={data.calendar.pageDestination(slug, page.id)}
                        calendars={data.calendar.calendars(slug)}
                        isReadOnly={isLocked}
                        {...(page.ownerName === undefined ? {} : { ownerName: page.ownerName })}
                        onChange={(calendarId) => void data.calendar.setPageDestination(slug, page.id, calendarId)}
                        settingsHref={calendarsHref(slug)}
                      />
                      {/* What happens once a booking is made, on the tab about the meeting itself (the owner, 27
                          October 2026): under a question's settings nobody found it. The same switch a form's
                          Settings has, in its words: it applies to every booking. */}
                      <Card title={strings.afterBooking}>
                        <Switch
                          label={strings.addToCrm}
                          isSelected={draft.fileToCrm}
                          isReadOnly={isLocked}
                          onChange={(fileToCrm) => change({ fileToCrm })}
                        />
                      </Card>
                    </>
                  )}
                  {shown === 'questions' && (
                    <>
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
                            isReadOnly={isLocked}
                            isDisabled={isMovingAnswers}
                            onChange={moveAnswers}
                          />
                        </Card>
                      )}
                      {draft.questions.length > 0 && (
                        <Callout tone="info">{isChatOff ? strings.chatOffRequired : strings.chatAsksNone}</Callout>
                      )}
                      <QuestionsSection
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
                        isReadOnly={isLocked}
                        {...(shownProblem === undefined ? {} : { problem: shownProblem })}
                      />
                    </>
                  )}
                  {isTeam && shown === 'hosts' && (
                    <>
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
                    </>
                  )}
                  {shown === 'hours' && (
                    <>
                      {/* In reading order (the owner, 22 Oct 2026): the schedule, its week, its days off, then
                          reserved time and conflicts, each a section with its heading. */}
                      {isTeam ? (
                        <Card title={strings.weeklyHours} description={rotationStrings.hoursMembers} />
                      ) : (
                        <Card
                          title={scheduleStrings.schedule}
                          actions={
                            <ButtonLink href={hours.manageHref} variant="ghost" size="sm" icon="settings">
                              {strings.manageSchedules}
                            </ButtonLink>
                          }
                        >
                          <Select
                            label={scheduleStrings.schedule}
                            isLabelHidden
                            items={hours.items}
                            value={draft.scheduleId ?? 'default'}
                            isReadOnly={isLocked || hours.items.length === 0 || isWeekDirty}
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
                            <WeekCard availability={week.shown} onChange={changeWeek} isReadOnly={isLocked} />
                            <DaysOff
                              availability={week.shown}
                              onChange={(next) => changeWeek(() => next)}
                              isReadOnly={isLocked}
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
                      />
                    </>
                  )}
                  {shown === 'limits' && (
                    <>
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
                    </>
                  )}
                </PreviewLayout>
              </TabPanel>
            </Tabs>
          </>
        ),
      }}
    />
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
  page: [strings.details, strings.sharing, socialsStrings.title],
  meeting: [strings.meeting, strings.location, strings.calendarSection, strings.afterBooking],
  questions: [questionStrings.questions],
  hosts: [rotationStrings.hosts, routingStrings.routing],
  hours: [scheduleStrings.schedule, strings.weeklyHours, strings.daysOff],
  limits: [strings.limitGroups.buffers, strings.limitGroups.window, strings.limitGroups.pace],
};

/**
 * The editor while its page loads: the tabs where the editor's will stand, and the chosen one's sections, titled and
 * busy, with skeleton fields. Hosts waits for the page, since only a round robin page has it.
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
    hours: strings.hours,
    limits: strings.limits,
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
              <PreviewLayout preview={<Skeleton shape="block" />} {...(notices === undefined ? {} : { notices })}>
                {PENDING_SECTIONS[shown].map((title) => (
                  <Card key={title} title={title} isBusy>
                    <Skeleton lines={3} />
                  </Card>
                ))}
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
