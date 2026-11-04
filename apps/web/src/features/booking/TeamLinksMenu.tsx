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
import { linksHref, pageEditorHref, publicBookingUrl } from './links.ts';
import { strings } from './strings.ts';

/** Props for TeamLinksMenu. */
export interface TeamLinksMenuProps {
  readonly slug: string;
}

/** Team links: the workspace link's Copy and Edit (or New, while there is none), and New team link. */
export function TeamLinksMenu({ slug }: TeamLinksMenuProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const canBookTeams = useCan('booking.admin');
  const canManageForms = useCan('forms.manage');
  const list = useCaptureList(data.bookingPages.view(slug));
  if (list.status !== 'ready') return null;
  const workspace = list.items.find((page) => page.scope === 'workspace');
  // A Team link sends people on to a live team page: with none, there is nothing to make it in front of.
  const hasTeamPage = list.items.some((page) => page.kind === 'round_robin' && page.status === 'live');
  const canMakeTeamLink = canManageForms && hasTeamPage;
  const canCopy = workspace !== undefined && workspace.status === 'live';
  const hasWorkspaceItems = canCopy || workspace?.canChange === true || (workspace === undefined && canBookTeams);
  if (!hasWorkspaceItems && !canMakeTeamLink) return null;
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
      <Button icon="users" label={strings.teamLinks} isLabelCollapsible>
        {strings.teamLinks}
      </Button>
      <Menu
        label={strings.teamLinks}
        onAction={(key) => {
          if (key === 'copy' && workspace !== undefined) copy(publicBookingUrl(workspace));
          if (key === 'edit' && workspace !== undefined) void navigate({ href: pageEditorHref(slug, workspace.id) });
          if (key === 'new-workspace') void navigate({ href: `${linksHref(slug)}?new=workspace` });
          if (key === 'new-team-link') void navigate({ href: `${linksHref(slug)}?new=team-link` });
        }}
      >
        {hasWorkspaceItems ? (
          <MenuSection label={strings.workspaceLink}>
            {canCopy && (
              <MenuItem id="copy" icon="copy" description={strings.workspaceLinkLine}>
                {strings.copyWorkspaceLink}
              </MenuItem>
            )}
            {workspace?.canChange === true && (
              <MenuItem id="edit" icon="pencil" description={strings.editWorkspaceLinkLine}>
                {strings.editWorkspaceLink}
              </MenuItem>
            )}
            {workspace === undefined && canBookTeams && (
              <MenuItem id="new-workspace" icon="building" description={strings.workspaceLinkLine}>
                {strings.addWorkspaceLink}
              </MenuItem>
            )}
          </MenuSection>
        ) : null}
        {canMakeTeamLink ? (
          <MenuSection label={strings.teamLink}>
            <MenuItem id="new-team-link" icon="list-filter" description={strings.teamLinkLine}>
              {strings.addTeamLink}
            </MenuItem>
          </MenuSection>
        ) : null}
      </Menu>
    </MenuTrigger>
  );
}
