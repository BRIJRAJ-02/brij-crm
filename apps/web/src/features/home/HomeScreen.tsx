// Brief
// Purpose: the workspace's landing page (spec 0041): what needs me now, in sections a feature adds by one entry.
// Main task: see today's meetings, tick a task due, reopen a recent record, or take the next setup step.
// Leaves out: any assistant or AI (the owner's call), and anything a section can't read for this member.
import type { InvitationView, MemberView, ObjectSummary, Permission, TaskList as TaskListSource } from '@crm/data';
import { usePreferences } from '@crm/data/react';
import { ButtonLink, PageColumn, SectionBar, TileGrid, TopBar, focusLater, useFormatSettings } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useNow } from '../bookings/useNow.ts';
import { reportsHref } from '../reports/search.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { dayPartOf, firstNameOf, hourIn } from './greeting.ts';
import { sectionRuns, visibleSections, withHidden, type HomeContext, type HomeSection } from './registry.ts';
import { HOME_SECTIONS } from './sections.tsx';
import { locale } from './sections/shared.tsx';
import { strings } from './strings.ts';

/** Props for Home, from the route's loader. */
export interface HomeScreenProps {
  readonly slug: string;
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberView[];
  readonly meId: string | undefined;
  readonly permissions: readonly Permission[];
  /** My open tasks assigned to me: the list My tasks holds; undefined when it couldn't be opened. */
  readonly tasks: TaskListSource | undefined;
  /** Open invitations, read only for a member who may invite. */
  readonly invitations: readonly InvitationView[] | undefined;
}

/** Home: the greeting, then the registry's sections, each loading on its own. */
export function HomeScreen(props: HomeScreenProps) {
  const { slug, members, meId } = props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const preferences = usePreferences(data.preferences.of(slug));
  const context: HomeContext = props;
  // Until the member's preferences arrive, a section they may have put away waits rather than showing and going.
  const hidden = preferences.status === 'ready' ? (preferences.preferences.homeHidden ?? []) : undefined;
  const sections = visibleSections(HOME_SECTIONS, context, hidden ?? []).filter(
    (section) => hidden !== undefined || preferences.status === 'error' || section.isHideable !== true,
  );
  // Only once the preferences are in can a section be put away (and brought back with Undo, or in Preferences).
  const hide =
    hidden === undefined
      ? undefined
      : (id: string) => {
          const before = hidden;
          void data.preferences.change(slug, { homeHidden: [...withHidden(before, id)] }).then((landed) => {
            if (!landed) return;
            toasts.toast({
              tone: 'success',
              message: strings.hidden,
              action: {
                label: strings.undo,
                onAction: () => {
                  void data.preferences.change(slug, { homeHidden: [...before] });
                },
              },
            });
          });
          // The section's own control goes with it: focus goes back to the page's title.
          focusLater(() => document.querySelector<HTMLElement>('h1'));
        };
  const me = members.find((member) => member.id === meId);
  return (
    <WorkspacePage
      currentPage="home"
      page={{
        topBar: (
          <TopBar title={strings.home} icon="house">
            <ButtonLink variant="secondary" icon="chart-bar" href={reportsHref(slug)}>
              {strings.reports}
            </ButtonLink>
          </TopBar>
        ),
        body: (
          <PageColumn>
            <Greeting name={firstNameOf(me?.name)} />
            {sectionRuns(sections).map((run) =>
              run.width === 'full' ? (
                <Section key={run.key} section={run.sections[0]} context={context} onHide={hide} />
              ) : (
                <TileGrid key={run.key} columns="two">
                  {run.sections.map((section) => (
                    <Section key={section.id} section={section} context={context} onHide={hide} />
                  ))}
                </TileGrid>
              ),
            )}
          </PageColumn>
        ),
      }}
    />
  );
}

/** One section from the registry, given its Hide where its entry allows one. */
function Section({
  section,
  context,
  onHide,
}: {
  readonly section: HomeSection | undefined;
  readonly context: HomeContext;
  readonly onHide: ((id: string) => void) | undefined;
}) {
  if (section === undefined) return null;
  const { Component } = section;
  return (
    <Component
      context={context}
      {...(section.isHideable === true && onHide !== undefined
        ? {
            onHide: () => {
              onHide(section.id);
            },
          }
        : {})}
    />
  );
}

/** "Good morning, Ada" and today's date, by the member's own time zone (Preferences). */
function Greeting({ name }: { readonly name: string | undefined }) {
  const { timeZone } = useFormatSettings();
  const now = useNow();
  const part = dayPartOf(hourIn(now, timeZone));
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone }),
    [timeZone],
  );
  return <SectionBar title={strings.greeting[part](name)} description={date.format(now)} />;
}
