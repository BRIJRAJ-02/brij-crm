// Brief
// Purpose: Settings › Profile, Pages on your profile (owner ask A102): the order your profile at /<handle> lists your
// Public booking pages in, under their sections.
// Main task: move a page within its section, or a whole section, by dragging its grip, by the keyboard on the grip
// (Enter, the arrows, Enter), or with Move up and Move down in its menu; each move saves at once.
// Leaves out: moving a page to another section (the page editor's Section), Link only pages (never listed), pages in
// your other workspaces, and anything else about a page (its editor, which its row opens).
import { isDataError, type BookingPageView, type DataLayer, type MyProfile } from '@crm/data';
import { useCaptureList } from '@crm/data/react';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  LinkList,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SectionList,
  SettingsSection,
  VisuallyHidden,
  type EmptyStateProps,
  type LinkRow,
  type SectionListSection,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { linksHref, pageEditorHref, publicProfileUrl } from '../booking/links.ts';
import { useMyAccess } from '../workspace/WorkspacePage.tsx';
import {
  fittedOrder,
  orderOf,
  profileGroupsOf,
  profilePagesOf,
  sectionId,
  sectionKeyOf,
  withPageMoved,
  withSectionMoved,
} from './profile-order.ts';
import { strings } from './profile-pages-strings.ts';

/** Props for the Pages on your profile section. */
export interface ProfilePagesSectionProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
}

/**
 * The section under Public profile: its heading with View profile at its end, then the person's Public pages under
 * their sections, each section a Card that moves whole, each page a row that moves within its section and opens its
 * editor. Without a handle there is no profile yet, so it says to claim one first.
 */
export function ProfilePagesSection({ data, slug, profile }: ProfilePagesSectionProps) {
  const access = useMyAccess();
  const { handle } = profile;
  let body: ReactNode;
  if (handle === undefined) {
    body = (
      <Note icon="at-sign" title={strings.noHandle}>
        {strings.noHandleText}
      </Note>
    );
  } else if (access === undefined) {
    body = <ProfilePagesLoading />;
  } else if (!access.permissions.includes('booking.manage')) {
    // The pages can't be read without it, and the server refuses a move on its own anyway.
    body = (
      <Note tone="locked" title={strings.noAccess}>
        {strings.noAccessText}
      </Note>
    );
  } else {
    body = <ProfilePages data={data} slug={slug} memberId={profile.memberId} />;
  }
  return (
    <SettingsSection
      title={strings.section}
      description={strings.sectionText}
      {...(handle === undefined
        ? {}
        : {
            actions: (
              <ButtonLink icon="external-link" href={publicProfileUrl(handle)} isExternal>
                {strings.viewProfile}
              </ButtonLink>
            ),
          })}
    >
      {body}
    </SettingsSection>
  );
}

/** The pages while they load: one card of skeleton rows, each grip's place held, after the loading delay. */
export function ProfilePagesLoading() {
  return (
    <Card isBusy>
      <LinkList
        label={strings.pages}
        searchLabel={strings.pages}
        density="compact"
        placement="card"
        isToolbarHidden
        rows={[]}
        status="loading"
        onOpen={() => undefined}
        onMove={() => undefined}
      />
    </Card>
  );
}

/** A state of the section in place of its pages: one quiet row in a Card. */
function Note({ children, ...props }: Pick<EmptyStateProps, 'title' | 'icon' | 'tone' | 'actions' | 'children'>) {
  return (
    <Card>
      <EmptyState layout="row" {...props}>
        {children}
      </EmptyState>
    </Card>
  );
}

/**
 * Move up and Move down, only the moves there is room for: the way to move without dragging (WCAG 2.5.7). A page's
 * menu ends with Change section, which opens its editor, where its Section is, since a page never leaves its section
 * here.
 */
function MoveMenu({
  label,
  at,
  count,
  onMove,
  onChangeSection,
}: {
  /** The menu button's name: "More for Intro call", "Sales options". */
  readonly label: string;
  readonly at: number;
  readonly count: number;
  readonly onMove: (toIndex: number) => void;
  readonly onChangeSection?: () => void;
}) {
  const canMove = count > 1;
  return (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={label} />
      <Menu
        label={label}
        onAction={(key) => {
          if (key === 'section') onChangeSection?.();
          else onMove(key === 'up' ? at - 1 : at + 1);
        }}
      >
        {at > 0 && (
          <MenuItem id="up" icon="chevron-up">
            {strings.moveUp}
          </MenuItem>
        )}
        {at < count - 1 && (
          <MenuItem id="down" icon="chevron-down">
            {strings.moveDown}
          </MenuItem>
        )}
        {onChangeSection !== undefined && canMove && <MenuSeparator />}
        {onChangeSection !== undefined && (
          <MenuItem id="section" icon="pencil">
            {strings.changeSection}
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}

/**
 * The person's Public pages from the held booking pages list (the one copy every screen reads, which a move changes
 * at once), under their sections in the profile's order. Every move sends the whole order; a refusal puts the
 * order back (the data layer does) and says so once, with Try again.
 */
function ProfilePages({
  data,
  slug,
  memberId,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly memberId: string;
}) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const view = data.bookingPages.view(slug);
  const list = useCaptureList(view);
  const pages = useMemo(() => (list.status === 'ready' ? profilePagesOf(list.items, memberId) : []), [list, memberId]);
  const groups = useMemo(() => profileGroupsOf(pages), [pages]);
  // What a menu's move says to screen readers; a drag says its own.
  const [said, setSaid] = useState('');
  // The refusal's toast, which the next move closes: its Try again would send an older order over the new one.
  const refusal = useRef<string | undefined>(undefined);

  /** The whole order as the held list stands now, read when a Try again is pressed, however long after. */
  const orderNow = (): readonly string[] => {
    const now = view.getSnapshot();
    return now.status === 'ready' ? orderOf(profileGroupsOf(profilePagesOf(now.items, memberId))) : [];
  };
  const send = (ids: readonly string[]) => {
    if (refusal.current !== undefined) toasts.dismiss(refusal.current);
    refusal.current = undefined;
    data.bookingPages.reorderProfile(slug, ids).catch((error: unknown) => {
      // The list may be behind (a page deleted or made Link only elsewhere): read again; it shows on meanwhile.
      view.reload();
      refusal.current = toasts.toast({
        tone: 'danger',
        message: isDataError(error) ? `${strings.moveFailed} ${error.message}` : strings.moveFailed,
        action: {
          label: strings.tryAgain,
          onAction: () => {
            const now = orderNow();
            if (now.length > 0) send(fittedOrder(ids, now));
          },
        },
      });
    });
  };
  const movePage = (page: BookingPageView, toIndex: number, count: number) => {
    setSaid(strings.moved(page.title, toIndex + 1, count));
    send(withPageMoved(groups, page.id, toIndex));
  };
  const moveSection = (key: string, title: string, toIndex: number) => {
    setSaid(strings.moved(title, toIndex + 1, groups.length));
    send(withSectionMoved(groups, key, toIndex));
  };

  if (list.status === 'loading') return <ProfilePagesLoading />;
  if (list.status === 'error') {
    return (
      <Card>
        <LinkList
          label={strings.pages}
          searchLabel={strings.pages}
          density="compact"
          placement="card"
          isToolbarHidden
          rows={[]}
          status="error"
          errorTitle={strings.failed}
          onRetry={() => {
            view.reload();
          }}
          onOpen={() => undefined}
        />
      </Card>
    );
  }
  if (groups.length === 0) {
    return (
      <Note
        icon="calendar-clock"
        title={strings.empty}
        actions={<ButtonLink href={linksHref(slug)}>{strings.openLinks}</ButtonLink>}
      >
        {strings.emptyText}
      </Note>
    );
  }

  // Several sections are all titled, the pages with none under "No section"; one untitled section is a plain card.
  const isSplit = groups.length > 1;
  const sections: SectionListSection[] = groups.map((group, at) => {
    const title = group.title ?? (isSplit ? strings.noSection : undefined);
    const count = group.items.length;
    const rows: LinkRow[] = group.items.map((page, index) => ({
      id: page.id,
      title: page.title,
      address: '',
      chips: page.durations.map((minutes) => strings.minutes(minutes)),
      // Paused: visitors don't see it until it is resumed, and it keeps its place meanwhile.
      ...(page.status === 'paused' ? { badge: strings.paused, isOff: true } : {}),
      href: pageEditorHref(slug, page.id),
      actions: (
        <MoveMenu
          label={strings.moreFor(page.title)}
          at={index}
          count={count}
          onMove={(toIndex) => {
            movePage(page, toIndex, count);
          }}
          onChangeSection={() => void navigate({ href: pageEditorHref(slug, page.id) })}
        />
      ),
    }));
    const label = title === undefined ? strings.pages : strings.pagesUnder(title);
    return {
      id: sectionId(group.key),
      ...(title === undefined ? {} : { title }),
      ...(isSplit && title !== undefined
        ? {
            actions: (
              <MoveMenu
                label={strings.sectionOptions(title)}
                at={at}
                count={groups.length}
                onMove={(toIndex) => {
                  moveSection(group.key, title, toIndex);
                }}
              />
            ),
          }
        : {}),
      content: (
        <LinkList
          label={label}
          searchLabel={label}
          density="compact"
          placement="card"
          isToolbarHidden
          rows={rows}
          onOpen={(id) => void navigate({ href: pageEditorHref(slug, id) })}
          onMove={(id, toIndex) => {
            send(withPageMoved(groups, id, toIndex));
          }}
        />
      ),
    };
  });
  return (
    <>
      <SectionList
        label={strings.sections}
        sections={sections}
        onMove={(id, toIndex) => {
          const key = sectionKeyOf(id);
          if (key !== undefined) send(withSectionMoved(groups, key, toIndex));
        }}
      />
      <VisuallyHidden>
        <span role="status">{said}</span>
      </VisuallyHidden>
    </>
  );
}
