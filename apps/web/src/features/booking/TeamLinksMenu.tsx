// Brief
// Purpose: the shareable links that aren't page types (the bookings area, 4 November 2026): the workspace's own link
// and the Team link, on the Links header as one menu, rather than as choices in New booking page.
// Main task: copy the workspace link (or make it, for an admin), or make a Team link (a form in front of the team pages).
// Leaves out: the pages themselves (the list) and what each link holds (its editor). An item that can't apply is left
// out, never shown turned off; with nothing to offer, the menu isn't there.
import { useCaptureList } from '@crm/data/react';
import { Button, Menu, MenuItem, MenuSection, MenuTrigger } from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { bookingsSettingsHref, linksHref, pageEditorHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';
import { followsEveryone } from './team-readiness.ts';

/** Props for TeamLinksMenu. */
export interface TeamLinksMenuProps {
  readonly slug: string;
  /**
   * New workspace link and New team link open their dialog here (Bookings › Pages, which holds New page's dialog);
   * left out, they go to Captures › Links, which opens it from its address.
   */
  readonly onNew?: (kind: 'workspace' | 'team-link') => void;
}

/** Team links: the workspace link's Copy and Edit (or New, while there is none), and New team link. */
export function TeamLinksMenu({ slug, onNew }: TeamLinksMenuProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canBookTeams = useCan('booking.admin');
  const canManageForms = useCan('forms.manage');
  // Teams (round robin's groups) live in Bookings settings, for whoever may shape them.
  const canManageTeams = useCan('booking.manage');
  const list = useCaptureList(data.bookingPages.view(slug));
  const rotations = useCaptureList(data.rotations.view(slug));
  // While the pages load, the button holds its place (turned off) for anyone who may have something in it, so New
  // never shifts when it arrives (design review, 5 November 2026).
  if (list.status === 'loading' || rotations.status === 'loading') {
    return canBookTeams || canManageForms ? (
      <Button iconRight="chevron-down" label={strings.teamLinks} isPending>
        {strings.teamLinks}
      </Button>
    ) : null;
  }
  // A failed read offers nothing rather than a dead button; the list below says it failed, with Try again.
  if (list.status !== 'ready') return null;
  // The workspace's own link: the page that books everyone. A team page on one group isn't it, though it shares the
  // workspace's address.
  const rotationItems = rotations.status === 'ready' ? rotations.items : [];
  const workspace = list.items.find((page) => followsEveryone(page, rotationItems));
  // A Team link sends people on to a live team page: with none, there is nothing to make it in front of.
  const hasTeamPage = list.items.some((page) => page.kind === 'round_robin' && page.status === 'live');
  const canMakeTeamLink = canManageForms && hasTeamPage;
  const canCopy = workspace !== undefined && workspace.status === 'live';
  // New workspace link sits with the workspace link's own items (the mock of 9 November 2026), for an admin, once the
  // groups are read.
  const canMake = canBookTeams && rotations.status === 'ready';
  const hasWorkspaceItems = canCopy || workspace?.canChange === true || canMake;
  if (!hasWorkspaceItems && !canMakeTeamLink && !canManageTeams) return null;
  const copy = (link: string) => {
    // No clipboard outside a secure context: said, rather than failing without a word.
    if (typeof navigator.clipboard === 'undefined') {
      toasts.toast({ tone: 'danger', message: strings.copyFailed });
      return;
    }
    navigator.clipboard.writeText(link).then(
      () => toasts.toast({ tone: 'success', message: strings.workspaceLinkCopied }),
      () => toasts.toast({ tone: 'danger', message: strings.copyFailed }),
    );
  };
  return (
    <MenuTrigger>
      <Button iconRight="chevron-down" label={strings.teamLinks}>
        {strings.teamLinks}
      </Button>
      <Menu
        label={strings.teamLinks}
        onAction={(key) => {
          if (key === 'copy' && workspace !== undefined) copy(publicBookingUrl(workspace));
          if (key === 'edit' && workspace !== undefined) {
            void navigate({ href: pageEditorHref(slug, workspace.id, 'hosts') });
          }
          if (key === 'new-workspace') {
            if (onNew === undefined) void navigate({ href: `${linksHref(slug)}?new=workspace` });
            else onNew('workspace');
          }
          if (key === 'new-team-link') {
            if (onNew === undefined) void navigate({ href: `${linksHref(slug)}?new=team-link` });
            else onNew('team-link');
          }
          if (key === 'teams') void navigate({ href: bookingsSettingsHref(slug, 'teams') });
        }}
      >
        {hasWorkspaceItems ? (
          <MenuSection label={strings.workspaceLink}>
            {canCopy && (
              <MenuItem id="copy" icon="copy">
                {strings.copyLink}
              </MenuItem>
            )}
            {workspace?.canChange === true && (
              <MenuItem id="edit" icon="pencil">
                {strings.editHoursAndHosts}
              </MenuItem>
            )}
            {canMake && (
              <MenuItem id="new-workspace" icon="plus">
                {strings.addWorkspaceLink}
              </MenuItem>
            )}
          </MenuSection>
        ) : null}
        {canMakeTeamLink || canManageTeams ? (
          <MenuSection label={strings.teamsSection}>
            {canMakeTeamLink ? (
              <MenuItem id="new-team-link" icon="git-branch" description={strings.teamLinkLine}>
                {strings.addTeamLink}
              </MenuItem>
            ) : null}
            {canManageTeams ? (
              <MenuItem id="teams" icon="users">
                {strings.manageTeams}
              </MenuItem>
            ) : null}
          </MenuSection>
        ) : null}
      </Menu>
    </MenuTrigger>
  );
}
