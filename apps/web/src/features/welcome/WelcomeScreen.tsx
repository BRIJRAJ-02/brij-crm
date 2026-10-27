// Brief
// Purpose: first run (spec 0036): a new person says who they are, names their workspace and may connect a calendar,
// or (spec 0031) someone with a workspace makes another, starting at Your workspace,
// watching the workspace take shape beside each step.
// Main task: Your name, Your workspace (Create workspace), Your link, Your booking page, Connect your calendar
// and Invite your team, into the workspace. Your link and Your booking page can't be skipped (the owner, 27
// October 2026): a link page and something to book are the product, so first run makes both.
// Leaves out: a photo (file storage), templates, and a questionnaire (taken out 22 October 2026).
import { isDataError, type DataLayer, type RoleOption, type SignedInUser, type WorkspaceSummary } from '@crm/data';
import { AuthLayout, Button, ButtonLink, Steps, WorkspacePreview, type WorkspacePreviewFocus } from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionStore } from '../auth/pending.ts';
import { SignOutDialog } from '../auth/SignOutDialog.tsx';
import { strings as authStrings } from '../auth/strings.ts';
import { focusPage } from '../navigation/focus.ts';
import { PRODUCT_LOGO } from '../../brand.ts';
import { handleBaseFor } from '@crm/contracts/handles';
import { AboutStep } from './AboutStep.tsx';
import { BookingPagePreview } from './BookingPagePreview.tsx';
import { BookingStep } from './BookingStep.tsx';
import { HandleStep } from './HandleStep.tsx';
import { LinkPagePreview } from './LinkPagePreview.tsx';
import { memberZone } from '../booking/zone.ts';
import { CalendarStep } from './CalendarStep.tsx';
import { InviteStep } from './InviteStep.tsx';
import { clearDraft, readDraft, saveDraft } from './draft.ts';
import { addressCandidates } from '../address/address.ts';
import { memberNameFor, suggestedWorkspaceName } from './names.ts';
import { refusalsOf, type WelcomeRefusal } from './refusals.ts';
import { needsWorkspace, nextStep, previousStep, welcomeSteps, type ConnectResult, type WelcomeStep } from './steps.ts';
import { strings } from './strings.ts';
import { useAddress } from '../address/useAddress.ts';
import { WorkspaceStep } from './WorkspaceStep.tsx';

/** The length a first booking page offers until its owner changes it. */
const DEFAULT_MINUTES = 30;

/** Each step's title and the line under it. */
const COPY: Readonly<Record<WelcomeStep, { readonly title: string; readonly description: string }>> = {
  about: { title: strings.aboutTitle, description: strings.aboutDescription },
  workspace: { title: strings.workspaceTitle, description: strings.workspaceDescription },
  handle: { title: strings.handleTitle, description: strings.handleDescription },
  booking: { title: strings.bookingTitle, description: strings.bookingDescription },
  invite: { title: strings.inviteTitle, description: strings.inviteDescription },
  calendar: { title: strings.calendarTitle, description: strings.calendarDescription },
};

/** The part of the workspace sketch each step that shows it is about. */
const FOCUS: Readonly<Record<WelcomeStep, WorkspacePreviewFocus>> = {
  about: 'person',
  workspace: 'workspace',
  handle: 'person',
  booking: 'workspace',
  invite: 'workspace',
  calendar: 'calendar',
};

/**
 * The steps whose preview is the person's own link page rather than the
 * workspace sketch: the one that names it, and Invite your team, which is
 * where its address is handed over. Your booking page shows that page
 * instead (the owner, 27 October 2026).
 */
const PAGE_PREVIEW: readonly WelcomeStep[] = ['handle', 'invite'];

/** Props for first run. */
export interface WelcomeScreenProps {
  readonly data: DataLayer;
  readonly user: SignedInUser;
  /** The step to show (the route keeps the calendar step for after the workspace exists). */
  readonly step: WelcomeStep;
  /** Whether calendar sync is set up here: without it, there is no calendar step. */
  readonly calendarSync: boolean;
  /** The workspace once it is made: the calendar step's. */
  readonly workspace?: WorkspaceSummary | undefined;
  /** What a calendar connect came back with (`?calendar=`). */
  readonly calendarResult?: ConnectResult | undefined;
  /**
   * Making another workspace (spec 0031, AC-801): the workspace the footer
   * goes back to, in place of Sign out, and the steps start at Your workspace.
   */
  readonly leaveTo?: { readonly slug: string; readonly name: string } | undefined;
  /** The roles Invite your team offers and the one rows start with; undefined when unread (everyone as a member). */
  readonly inviteRoles?: { readonly roles: readonly RoleOption[]; readonly defaultRole: string } | undefined;
  /** The handle of the link page made with the workspace (26 Oct 2026), once claimed; undefined until Your link. */
  readonly linkPageHandle?: string | undefined;
  /** A free handle made from their name, the first value of Your link's field. */
  readonly suggestedHandle?: string | undefined;
  /** They already have a booking page, so Your booking page isn't asked for. */
  readonly hasBookingPage?: boolean;
}

/**
 * First run: AuthLayout's split card, the step on the left and the workspace
 * taking shape on the right, with Back and "Step N of M" above each step's
 * title, and who is signed in with Sign out (which asks first) at its foot.
 * What is typed is kept in this tab (`draft.ts`) until the workspace is made.
 */
export function WelcomeScreen({
  data,
  user,
  step,
  calendarSync,
  workspace,
  calendarResult,
  leaveTo,
  inviteRoles,
  linkPageHandle,
  suggestedHandle,
  hasBookingPage = false,
}: WelcomeScreenProps) {
  const navigate = useNavigate();
  const router = useRouter();
  const storage = sessionStore(window);
  // What was typed before a reload, with the workspace's id: minted once, and sent again on every try.
  const [draft] = useState(() => readDraft(storage, user.id));
  const [id, setId] = useState(() => draft?.workspaceId ?? data.workspaces.newId());
  const [memberName, setMemberName] = useState(draft?.memberName ?? user.name);
  // The workspace name follows the person's name, and the address the workspace name, until each is edited.
  const [typedName, setTypedName] = useState<string | undefined>(draft?.workspaceName);
  const [typedSlug, setTypedSlug] = useState<string | undefined>(draft?.slug);
  const shownName = memberNameFor(memberName, '', user.email);
  const name = typedName ?? suggestedWorkspaceName(shownName, strings.possessive);
  // The address follows the name (the first free one made from it, or from a company email) until it is typed or picked.
  const candidates = useMemo(() => addressCandidates(name, user.email), [name, user.email]);
  const check = useCallback((candidate: string) => data.workspaces.slugAvailable(candidate), [data]);
  const address = useAddress(check, candidates, typedSlug);
  const slug = address.slug;
  const [isCreating, setCreating] = useState(false);
  const [refusals, setRefusals] = useState<readonly WelcomeRefusal[]>([]);
  const [isConnecting, setConnecting] = useState(false);
  // Your link: the suggested handle until it is typed, then whatever was claimed.
  const [claimedHandle, setClaimedHandle] = useState<string | undefined>(linkPageHandle);
  const [typedHandle, setTypedHandle] = useState<string | undefined>(undefined);
  // The field is never empty: the handle they hold, else the server's free suggestion, else one made here from
  // their name the same way the server makes it. A blank field would read as a step with nothing in it.
  const madeHandle = useMemo(() => handleBaseFor(shownName, user.email), [shownName, user.email]);
  const handle = typedHandle ?? claimedHandle ?? suggestedHandle ?? madeHandle;
  const [isClaiming, setClaiming] = useState(false);
  const [handleRefusals, setHandleRefusals] = useState<readonly WelcomeRefusal[]>([]);
  // Your booking page: its id is minted on the first try and sent again on every retry, so a lost answer leaves
  // one page, not two. Minted there rather than here, so no step before it asks the data layer for one.
  const pageId = useRef<string | undefined>(undefined);
  const [pageTitle, setPageTitle] = useState('');
  const [pageMinutes, setPageMinutes] = useState(DEFAULT_MINUTES);
  const [isCreatingPage, setCreatingPage] = useState(false);
  const [pageRefusals, setPageRefusals] = useState<readonly WelcomeRefusal[]>([]);
  const [isSignOutOpen, setSignOutOpen] = useState(false);
  const [isSigningOut, setSigningOut] = useState(false);
  const [signOutFailure, setSignOutFailure] = useState<string | undefined>(undefined);

  // Kept until the workspace is made, so a reload keeps what was typed.
  useEffect(() => {
    if (workspace !== undefined) return;
    saveDraft(storage, {
      userId: user.id,
      workspaceId: id,
      memberName,
      ...(typedName === undefined ? {} : { workspaceName: typedName }),
      ...(typedSlug === undefined ? {} : { slug: typedSlug }),
    });
  }, [storage, user.id, id, memberName, typedName, typedSlug, workspace]);

  // Back from Google with the browser's back button, the page comes out of the back/forward cache as it was
  // left: "Opening Google". Start over.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setConnecting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  // A step change keeps the page, so the route moves no focus: the new step's first field takes it here (the
  // calendar step puts it on its first button itself). The first step shown is the route's to focus.
  const focusedStep = useRef(step);
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    // The calendar and Invite your team's sent state put focus on their own first button.
    if (step !== 'calendar') focusPage(document, '/welcome');
  }, [step]);

  // Another workspace skips what is known about the person, so its count is its own ("Step 1 of 2").
  // What was already done when first run opened, held still: the list, and so "Step N of M", must not shrink
  // under the person as they do the very steps it counts.
  const [done] = useState(() => ({ booking: hasBookingPage }));
  const steps = welcomeSteps(calendarSync, leaveTo !== undefined, done);
  const back = leaveTo === undefined ? previousStep(step) : undefined;
  // The step this one was reached from by Continue: Back then goes back through the browser's history, so the
  // browser's own back button and ours agree.
  const cameFrom = useRef<WelcomeStep | undefined>(undefined);
  // Another workspace keeps its own count (and its way back) through the steps after the workspace.
  const another = leaveTo === undefined ? {} : { another: true as const };
  const goTo = (next: WelcomeStep) => {
    cameFrom.current = step;
    // The workspace stays in the address: every step after it needs it, and a move that dropped it would leave
    // the route with nothing to show and send the person to their workspace instead (27 October 2026).
    void navigate({
      to: '/welcome',
      search: { step: next, ...(workspace === undefined ? {} : { workspace: workspace.slug }), ...another },
    });
  };
  const goBack = () => {
    if (back === undefined) return;
    if (cameFrom.current === back) {
      cameFrom.current = undefined;
      router.history.back();
      return;
    }
    void navigate({ to: '/welcome', search: { step: back }, replace: true });
  };
  const openWorkspace = () => {
    if (workspace !== undefined) void navigate({ to: '/w/$slug', params: { slug: workspace.slug }, replace: true });
  };
  // The step after this one, or, after the last, the workspace itself.
  const after = (finished: WelcomeStep) => {
    const next = nextStep(steps, finished);
    if (next === undefined) openWorkspace();
    else goTo(next);
  };

  const create = () => {
    setCreating(true);
    setRefusals([]);
    const memberNameSent = memberNameFor(memberName, user.name, user.email);
    data.workspaces.create({ id, name: name.trim(), slug, memberName: memberNameSent }).then(
      async ({ workspace: made }) => {
        clearDraft(storage);
        // The first step after the workspace loads with it before it shows, so the card goes straight there.
        const firstAfter = steps.find(needsWorkspace) ?? 'invite';
        const nextStepHref = {
          to: '/welcome',
          search: { step: firstAfter, workspace: made.slug, ...another },
        } as const;
        await router.preloadRoute(nextStepHref).catch(() => undefined);
        void navigate({ ...nextStepHref, replace: true });
      },
      (failure: unknown) => {
        // Someone else's workspace has this id (vanishingly rare): the next try gets a new one.
        if (isDataError(failure) && failure.code === 'ID_TAKEN') setId(data.workspaces.newId());
        setCreating(false);
        setRefusals(refusalsOf(failure));
      },
    );
  };

  /**
   * Your link: claims the handle, which names the link page made with the
   * workspace and every booking page under it. A taken one comes back on the
   * field; the server has the last word, so nothing is checked as it is typed.
   */
  const claim = () => {
    if (workspace === undefined || isClaiming) return;
    const wanted = handle.trim();
    setClaiming(true);
    setHandleRefusals([]);
    data.profile.update(workspace.slug, { handle: wanted }).then(
      (profile) => {
        setClaiming(false);
        setClaimedHandle(profile.handle ?? wanted);
        after('handle');
      },
      (failure: unknown) => {
        setClaiming(false);
        setHandleRefusals(refusalsOf(failure));
      },
    );
  };

  /**
   * Your booking page: one page with its name and one length, booking by the
   * person's default schedule. It joins the end of the link page by itself
   * (spec 0051), so nothing here puts it there.
   */
  const createPage = () => {
    if (workspace === undefined || isCreatingPage) return;
    setCreatingPage(true);
    setPageRefusals([]);
    data.bookingPages
      .create(workspace.slug, {
        id: (pageId.current ??= data.bookingPages.newId()),
        title: pageTitle.trim(),
        timeZone: memberZone(data, workspace.slug),
        settings: { durations: [pageMinutes], scheduleId: null },
      })
      .then(
        () => {
          setCreatingPage(false);
          after('booking');
        },
        (failure: unknown) => {
          // Someone else's page has this id (vanishingly rare): the next try gets a new one.
          if (isDataError(failure) && failure.code === 'ID_TAKEN') pageId.current = data.bookingPages.newId();
          setCreatingPage(false);
          setPageRefusals(refusalsOf(failure));
        },
      );
  };

  const connect = () => {
    if (workspace === undefined) return;
    setConnecting(true);
    // The browser goes to the API, which sends it on to Google's consent and back to this step.
    window.location.assign(data.calendar.connectUrl(workspace.slug, 'welcome'));
  };

  const signOut = () => {
    if (isSigningOut) return;
    setSigningOut(true);
    setSignOutFailure(undefined);
    data.auth.signOut().then(
      () => {
        clearDraft(storage);
        void navigate({ to: '/sign-in', replace: true });
      },
      () => {
        setSigningOut(false);
        setSignOutFailure(authStrings.signOutFailed);
      },
    );
  };

  const { title, description } =
    leaveTo !== undefined && step === 'workspace'
      ? { title: strings.anotherTitle, description: strings.anotherDescription }
      : COPY[step];
  return (
    <>
      <AuthLayout
        productName={strings.product}
        logo={PRODUCT_LOGO}
        title={title}
        description={description}
        eyebrow={
          <>
            {back !== undefined && <Button variant="ghost" icon="arrow-left" label={strings.back} onPress={goBack} />}
            {steps.length > 1 && (
              <Steps
                variant="count"
                label={strings.steps}
                steps={steps.map((each) => ({ id: each, label: COPY[each].title }))}
                current={step}
              />
            )}
          </>
        }
        preview={
          // The two steps that make the link page, and the one that hands its address over, show the page itself;
          // the rest show the workspace taking shape.
          step === 'booking' ? (
            <BookingPagePreview name={shownName} title={pageTitle} minutes={pageMinutes} />
          ) : PAGE_PREVIEW.includes(step) ? (
            <LinkPagePreview
              name={shownName}
              id={claimedHandle ?? user.id}
              handle={handle}
              page={{ title: pageTitle, minutes: pageMinutes }}
            />
          ) : (
            <WorkspacePreview
              workspaceName={workspace?.name ?? name}
              workspaceId={workspace?.id ?? id}
              personName={shownName}
              personId={user.id}
              focus={FOCUS[step]}
            />
          )
        }
        account={user.email}
        footer={
          // Back leaves for the workspace the person came from, only until the new one exists: after that, the
          // steps' own Skip for now opens the new one.
          leaveTo === undefined || workspace !== undefined ? (
            <Button
              variant="link"
              onPress={() => {
                setSignOutFailure(undefined);
                setSignOutOpen(true);
              }}
            >
              {strings.signOut}
            </Button>
          ) : (
            <ButtonLink variant="link" icon="arrow-left" href={`/w/${leaveTo.slug}`}>
              {strings.back}
            </ButtonLink>
          )
        }
      >
        {step === 'about' && (
          <AboutStep
            memberName={memberName}
            onMemberName={setMemberName}
            shownName={shownName}
            userId={user.id}
            onContinue={() => {
              after('about');
            }}
          />
        )}
        {step === 'workspace' && (
          <WorkspaceStep
            name={name}
            onName={setTypedName}
            address={address}
            onSlug={setTypedSlug}
            isCreating={isCreating}
            refusals={refusals}
            onCreate={create}
          />
        )}
        {step === 'handle' && (
          <HandleStep
            handle={handle}
            onHandle={setTypedHandle}
            isClaiming={isClaiming}
            refusals={handleRefusals}
            onClaim={claim}
          />
        )}
        {step === 'booking' && (
          <BookingStep
            title={pageTitle}
            onTitle={setPageTitle}
            minutes={pageMinutes}
            onMinutes={setPageMinutes}
            isCreating={isCreatingPage}
            refusals={pageRefusals}
            onCreate={createPage}
          />
        )}
        {step === 'calendar' && (
          <CalendarStep
            result={calendarResult}
            onConnect={connect}
            isConnecting={isConnecting}
            onFinish={() => {
              after('calendar');
            }}
          />
        )}
        {step === 'invite' && workspace !== undefined && (
          <InviteStep
            data={data}
            slug={workspace.slug}
            roles={inviteRoles}
            onDone={() => {
              after('invite');
            }}
            handle={claimedHandle}
          />
        )}
      </AuthLayout>
      <SignOutDialog
        isOpen={isSignOutOpen}
        isBusy={isSigningOut}
        failure={signOutFailure}
        onSignOut={signOut}
        onClose={() => {
          setSignOutOpen(false);
        }}
      />
    </>
  );
}
