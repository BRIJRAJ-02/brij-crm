// Brief
// Purpose: first run (spec 0036): a new person says who they are, names their workspace and may connect a calendar,
// or (spec 0031) someone with a workspace makes another, starting at Your workspace,
// watching the workspace take shape beside each step.
// Main task: About you, then Your workspace (Create workspace), then Connect your calendar or skip, into People.
// Leaves out: inviting the team (after spec 0031 slice 2), a photo (file storage), templates and use case questions.
import { isDataError, type DataLayer, type SignedInUser, type WorkspaceSummary } from '@crm/data';
import { AuthLayout, Button, ButtonLink, Steps, WorkspacePreview, type WorkspacePreviewFocus } from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { sessionStore } from '../auth/pending.ts';
import { SignOutDialog } from '../auth/SignOutDialog.tsx';
import { strings as authStrings } from '../auth/strings.ts';
import { focusPage } from '../navigation/focus.ts';
import { PRODUCT_LOGO } from '../../brand.ts';
import { AboutStep } from './AboutStep.tsx';
import { CalendarStep } from './CalendarStep.tsx';
import { clearDraft, readDraft, saveDraft } from './draft.ts';
import { memberNameFor, slugFrom, suggestedWorkspaceName } from './names.ts';
import { refusalsOf, type WelcomeRefusal } from './refusals.ts';
import { nextStep, previousStep, welcomeSteps, type ConnectResult, type WelcomeStep } from './steps.ts';
import { strings } from './strings.ts';
import { WorkspaceStep } from './WorkspaceStep.tsx';

/** Each step's title and the line under it. */
const COPY: Readonly<Record<WelcomeStep, { readonly title: string; readonly description: string }>> = {
  about: { title: strings.aboutTitle, description: strings.aboutDescription },
  workspace: { title: strings.workspaceTitle, description: strings.workspaceDescription },
  calendar: { title: strings.calendarTitle, description: strings.calendarDescription },
};

/** The part of the preview each step is about. */
const FOCUS: Readonly<Record<WelcomeStep, WorkspacePreviewFocus>> = {
  about: 'person',
  workspace: 'workspace',
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
  const slug = typedSlug ?? slugFrom(name);
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
    if (step !== 'calendar') focusPage(document, '/welcome');
  }, [step]);

  const steps = welcomeSteps(calendarSync);
  const back = leaveTo === undefined ? previousStep(step) : undefined;
  // The step this one was reached from by Continue: Back then goes back through the browser's history, so the
  // browser's own back button and ours agree.
  const cameFrom = useRef<WelcomeStep | undefined>(undefined);
  const goTo = (next: WelcomeStep) => {
    cameFrom.current = step;
    void navigate({ to: '/welcome', search: { step: next } });
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
  const afterAbout = () => {
    const next = nextStep(steps, 'about');
    if (next !== undefined) goTo(next);
  };

  const create = () => {
    setCreating(true);
    setRefusals([]);
    const memberNameSent = memberNameFor(memberName, user.name, user.email);
    data.workspaces.create({ id, name: name.trim(), slug, memberName: memberNameSent }).then(
      async ({ workspace: made }) => {
        clearDraft(storage);
        if (!calendarSync) {
          void navigate({ to: '/w/$slug', params: { slug: made.slug }, replace: true });
          return;
        }
        // The calendar step loads with the new workspace before it shows, so the card goes straight to it.
        const calendarStep = { to: '/welcome', search: { step: 'calendar', workspace: made.slug } } as const;
        await router.preloadRoute(calendarStep).catch(() => undefined);
        void navigate({ ...calendarStep, replace: true });
      },
      (failure: unknown) => {
        // Someone else's workspace has this id (vanishingly rare): the next try gets a new one.
        if (isDataError(failure) && failure.code === 'ID_TAKEN') setId(data.workspaces.newId());
        setCreating(false);
        setRefusals(refusalsOf(failure));
      },
    );
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
            <Steps
              variant="count"
              label={strings.steps}
              steps={steps.map((each) => ({ id: each, label: COPY[each].title }))}
              current={step}
            />
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
          leaveTo === undefined ? (
            <Button
              variant="ghost"
              onPress={() => {
                setSignOutFailure(undefined);
                setSignOutOpen(true);
              }}
            >
              {strings.signOut}
            </Button>
          ) : (
            <ButtonLink variant="ghost" href={`/w/${leaveTo.slug}`}>
              {strings.backTo(leaveTo.name)}
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
            onContinue={afterAbout}
            onSkip={afterAbout}
          />
        )}
        {step === 'workspace' && (
          <WorkspaceStep
            data={data}
            name={name}
            onName={setTypedName}
            slug={slug}
            onSlug={setTypedSlug}
            isCreating={isCreating}
            refusals={refusals}
            onCreate={create}
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
