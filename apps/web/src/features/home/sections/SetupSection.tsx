// Home's setup checklist (spec 0041): the steps the member may take, done or
// not from real state, the next one's button, and Hide setup. Once every step
// is done it is one "You're all set" line, which Dismiss puts away for good.
import type { CaptureListView, InvitationView, MemberView, ObjectSummary, Permission } from '@crm/data';
import { useCalendar, useCaptureList } from '@crm/data/react';
import { SetupChecklist, type SetupChecklistStep } from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { importHref } from '../../imports/paths.ts';
import { InviteTeamDialog } from '../../settings/InviteTeamDialog.tsx';
import type { HomeSectionProps } from '../registry.ts';
import { setupSteps, type SetupFacts, type SetupStepId } from '../setup.ts';
import { strings } from '../strings.ts';

/** The setup steps' facts, how their reads stand, and how to read them again. */
interface SetupRead {
  readonly facts: SetupFacts;
  readonly status: 'loading' | 'error' | 'ready';
  readonly retry: () => void;
}

/** An empty list that is never read: a step the member may not take holds this, so nothing is fetched for it. */
function idleList<Item>(): CaptureListView<Item> {
  return {
    subscribe: () => () => undefined,
    getSnapshot: () => IDLE,
    retain: () => () => undefined,
    ready: () => Promise.resolve(),
    reload: () => undefined,
  };
}

/** The idle list's one snapshot (immutable), so React sees the same state every time it asks. */
const IDLE = { status: 'ready', items: [], pendingIds: new Set<string>() } as const;

/** What the setup steps are read from, each only for a member who may take that step. */
function useSetupFacts(
  slug: string,
  meId: string | undefined,
  permissions: readonly Permission[],
  members: readonly MemberView[],
  invitations: readonly InvitationView[] | undefined,
  people: ObjectSummary | undefined,
): SetupRead {
  const { data } = useRouteContext({ from: '__root__' });
  // How many records People holds, for Import your contacts: read once, a failure leaving the step out.
  const [contacts, setContacts] = useState<{ readonly id: string; readonly count: number } | undefined>(undefined);
  const peopleId = people?.id;
  useEffect(() => {
    if (peopleId === undefined) return;
    let isCurrent = true;
    data.records.count(slug, peopleId).then(
      (answer) => {
        if (isCurrent) setContacts({ id: peopleId, count: answer.count });
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, peopleId]);
  const mayPages = permissions.includes('booking.manage');
  const mayForms = permissions.includes('forms.manage');
  const calendarView = useMemo(() => data.calendar.view(slug), [data, slug]);
  const pagesView = useMemo(
    () => (mayPages ? data.bookingPages.view(slug) : idleList<never>()),
    [data, slug, mayPages],
  );
  const formsView = useMemo(() => (mayForms ? data.forms.view(slug) : idleList<never>()), [data, slug, mayForms]);
  const calendar = useCalendar(calendarView);
  const pages = useCaptureList(pagesView);
  const forms = useCaptureList(formsView);
  const reads = [calendar.status, pages.status, forms.status];
  return {
    status: reads.includes('loading') ? 'loading' : reads.includes('error') ? 'error' : 'ready',
    retry: () => {
      if (calendar.status === 'error') calendarView.reload();
      if (pages.status === 'error') pagesView.reload();
      if (forms.status === 'error') formsView.reload();
    },
    facts: {
      ...(calendar.status === 'ready' && calendar.enabled
        ? { calendars: calendar.connections.map((connection) => connection.accountEmail) }
        : {}),
      ...(mayPages && pages.status === 'ready'
        ? { bookingPages: pages.items.filter((page) => page.ownerMemberId === meId).length }
        : {}),
      ...(mayForms && forms.status === 'ready' ? { forms: forms.items.length } : {}),
      ...(contacts !== undefined && contacts.id === peopleId ? { contacts: contacts.count } : {}),
      ...(permissions.includes('members.invite') && invitations !== undefined
        ? { team: { members: members.length, invited: invitations.filter((each) => !each.isExpired).length } }
        : {}),
    },
  };
}

/** The fact a step's row ends in: the state of the thing it names, never a hint. */
function detailOf(id: SetupStepId, facts: SetupFacts): string {
  switch (id) {
    case 'calendar':
      return facts.calendars?.[0] ?? strings.notConnected;
    case 'bookingPage':
      return facts.bookingPages === undefined || facts.bookingPages === 0
        ? strings.noneYet
        : strings.pages(facts.bookingPages);
    case 'form':
      return facts.forms === undefined || facts.forms === 0 ? strings.noneYet : strings.forms(facts.forms);
    case 'contacts':
      return facts.contacts === undefined || facts.contacts === 0 ? strings.noneYet : strings.contacts(facts.contacts);
    case 'invite':
      if (facts.team === undefined) return strings.justYou;
      if (facts.team.members > 1) return strings.people(facts.team.members);
      return facts.team.invited > 0 ? strings.invited(facts.team.invited) : strings.justYou;
  }
}

/** Finish setting up: Home's first section. Draws nothing for a member who may take no step. */
export function SetupSection({ context, onHide }: HomeSectionProps) {
  const { slug, meId, permissions, members, invitations, objects } = context;
  // Import your contacts: People, for a member who may add to it.
  const people = objects.find(
    (object) => object.standardKey === 'people' && object.access === 'write' && !object.isArchived,
  );
  const navigate = useNavigate();
  const router = useRouter();
  const { data } = useRouteContext({ from: '__root__' });
  // Invite your team opens the one Invite dialog here, rather than leaving Home for Settings › Members.
  const [isInviting, setInviting] = useState(false);
  const setup = useSetupFacts(slug, meId, permissions, members, invitations, people);
  const steps: readonly SetupChecklistStep[] = setupSteps(setup.facts).map((step) => ({
    id: step.id,
    title: strings.steps[step.id].title,
    detail: detailOf(step.id, setup.facts),
    isDone: step.done,
    action: strings.steps[step.id].action,
  }));
  if (setup.status === 'ready' && steps.length === 0) return null;
  const open = (id: string) => {
    switch (id) {
      case 'calendar':
        void navigate({ to: '/w/$slug/settings/scheduling/calendars', params: { slug } });
        return;
      case 'bookingPage':
        void navigate({ to: '/w/$slug/captures/links', params: { slug } });
        return;
      case 'form':
        void navigate({ to: '/w/$slug/captures/forms', params: { slug } });
        return;
      case 'contacts':
        if (people !== undefined) void navigate({ href: importHref(slug, people) });
        return;
      case 'invite':
        setInviting(true);
    }
  };
  return (
    <>
      <SetupChecklist
        title={strings.setupTitle}
        steps={steps}
        status={setup.status}
        onRetry={setup.retry}
        onAction={open}
        {...(onHide === undefined ? {} : { onHide })}
      />
      <InviteTeamDialog
        data={data}
        slug={slug}
        isOpen={isInviting}
        onClose={() => {
          setInviting(false);
        }}
        // The step's line ("1 invited") reads the route's invitations, so the route reads them again.
        onInvited={() => {
          void router.invalidate();
        }}
      />
    </>
  );
}
