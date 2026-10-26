// Brief
// Purpose: first run (spec 0036): a new person says who they are, names their workspace and may connect a calendar,
// or (spec 0031) someone with a workspace makes another, starting at Your workspace,
// watching the workspace take shape beside each step.
// Main task: Your name, Your workspace (Create workspace), Invite your team, then Connect your calendar, into the
// workspace. Leaves out: a photo (file storage), templates, and a questionnaire (taken out 22 October 2026).
import { isDataError, type DataLayer, type RoleOption, type SignedInUser, type WorkspaceSummary } from '@crm/data';
import { AuthLayout, Button, ButtonLink, Steps, WorkspacePreview, type WorkspacePreviewFocus } from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sessionStore } from '../auth/pending.ts';
import { SignOutDialog } from '../auth/SignOutDialog.tsx';
import { strings as authStrings } from '../auth/strings.ts';
import { focusPage } from '../navigation/focus.ts';
import { PRODUCT_LOGO } from '../../brand.ts';
import { AboutStep } from './AboutStep.tsx';
import { CalendarStep } from './CalendarStep.tsx';
import { InviteStep } from './InviteStep.tsx';
import { clearDraft, readDraft, saveDraft } from './draft.ts';
import { addressCandidates } from '../address/address.ts';
import { memberNameFor, suggestedWorkspaceName } from './names.ts';
import { refusalsOf, type WelcomeRefusal } from './refusals.ts';
import { nextStep, previousStep, welcomeSteps, type ConnectResult, type WelcomeStep } from './steps.ts';
import { strings } from './strings.ts';
import { useAddress } from '../address/useAddress.ts';
import { WorkspaceStep } from './WorkspaceStep.tsx';

/** Each step's title and the line under it. */
const COPY: Readonly<Record<WelcomeStep, { readonly title: string; readonly description: string }>> = {
  about: { title: strings.aboutTitle, description: strings.aboutDescription },
  workspace: { title: strings.workspaceTitle, description: strings.workspaceDescription },
  invite: { title: strings.inviteTitle, description: strings.inviteDescription },
  calendar: { title: strings.calendarTitle, description: strings.calendarDescription },
};

/** The part of the preview each step is about. */
const FOCUS: Readonly<Record<WelcomeStep, WorkspacePreviewFocus>> = {
  about: 'person',
  workspace: 'workspace',
  invite: 'workspace',
  calendar: 'calendar',
};

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
  /** The handle of the link page made with the workspace (26 Oct 2026), said on Invite your team; undefined unread. */
  readonly linkPageHandle?: string | undefined;
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
  const steps = welcomeSteps(calendarSync, leaveTo !== undefined);
  const back = leaveTo === undefined ? previousStep(step) : undefined;
  // The step this one was reached from by Continue: Back then goes back through the browser's history, so the
  // browser's own back button and ours agree.
  const cameFrom = useRef<WelcomeStep | undefined>(undefined);
  const goTo = (next: WelcomeStep) => {
    cameFrom.current = step;
    void navigate({ to: '/welcome', search: { step: next } });
  };
  // Another workspace keeps its own count (and its way back) through the steps after the workspace.
  const another = leaveTo === undefined ? {} : { another: true as const };
  const goBack = () => {
    if (back === undefined) return;
    if (cameFrom.current === back) {
      cameFrom.current = undefined;
      router.history.back();
      return;
    }
    void navigate({ to: '/welcome', search: { step: back }, replace: true });
  };
  const after = (done: WelcomeStep) => {
    const next = nextStep(steps, done);
    if (next !== undefined) goTo(next);
  };

  const create = () => {
    setCreating(true);
    setRefusals([]);
    const memberNameSent = memberNameFor(memberName, user.name, user.email);
    data.workspaces.create({ id, name: name.trim(), slug, memberName: memberNameSent }).then(
      async ({ workspace: made }) => {
        clearDraft(storage);
        // Invite your team loads with the new workspace before it shows, so the card goes straight to it.
        const inviteStep = { to: '/welcome', search: { step: 'invite', workspace: made.slug, ...another } } as const;
        await router.preloadRoute(inviteStep).catch(() => undefined);
        void navigate({ ...inviteStep, replace: true });
      },
      (failure: unknown) => {
        // Someone else's workspace has this id (vanishingly rare): the next try gets a new one.
        if (isDataError(failure) && failure.code === 'ID_TAKEN') setId(data.workspaces.newId());
        setCreating(false);
        setRefusals(refusalsOf(failure));
      },
    );
  };

  const afterInvite = () => {
    if (workspace === undefined) return;
    if (!calendarSync) {
      void navigate({ to: '/w/$slug', params: { slug: workspace.slug }, replace: true });
      return;
    }
    void navigate({
      to: '/welcome',
      search: { step: 'calendar', workspace: workspace.slug, ...another },
      replace: true,
    });
  };

  const connect = () => {
    if (workspace === undefined) return;
    setConnecting(true);
    // The browser goes to the API, which sends it on to Google's consent and back to this step.
    window.location.assign(data.calendar.connectUrl(workspace.slug, 'welcome'));
  };
  const finish = () => {
    if (workspace !== undefined) void navigate({ to: '/w/$slug', params: { slug: workspace.slug }, replace: true });
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
          <WorkspacePreview
            workspaceName={workspace?.name ?? name}
            workspaceId={workspace?.id ?? id}
            personName={shownName}
            personId={user.id}
            focus={FOCUS[step]}
          />
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
            onSkip={() => {
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
        {step === 'invite' && workspace !== undefined && (
          <InviteStep
            data={data}
            slug={workspace.slug}
            roles={inviteRoles}
            onDone={afterInvite}
            handle={linkPageHandle}
          />
        )}
        {step === 'calendar' && (
          <CalendarStep result={calendarResult} onConnect={connect} isConnecting={isConnecting} onFinish={finish} />
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
