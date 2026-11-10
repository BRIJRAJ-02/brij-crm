// Where the link page screens are drawn: in the app's workspace frame, or embedded in a partner's frame (spec 0070,
// AC-7032, AC-7033). The screens are the same; the place gives them their own addresses (`/w/<slug>/link-page…` or
// `/embed/<clientId>/link-page…`), whether Team pages may be offered, and the workspace's name. Embedded, a screen
// draws no link outside the shared module: other modules' blocks, Settings and the booking page editor are left out.
import { createContext, useContext, type ReactNode } from 'react';
import { useCan, useWorkspaceName } from '../workspace/WorkspacePage.tsx';

/** An embedded frame's place: its own address, and what its session said. */
export interface EmbeddedPlace {
  /** `/embed/<clientId>/link-page`: every screen's address starts here. */
  readonly base: string;
  /** `light` or `dark` when the partner asked for one, kept in every address so a reload keeps it. */
  readonly theme?: 'light' | 'dark';
  readonly canManageTeam: boolean;
  readonly workspaceName: string;
  /** The partner app the frame sits in, by name: the words about a Timefix login name it (AC-7023). */
  readonly appName?: string;
}

const Place = createContext<EmbeddedPlace | undefined>(undefined);

/** Puts the link page screens under it in an embedded frame. */
export function EmbeddedLinkPages({
  place,
  children,
}: {
  readonly place: EmbeddedPlace;
  readonly children: ReactNode;
}) {
  return <Place value={place}>{children}</Place>;
}

/** Which link page screen an address opens: the person's own, Team pages, or a member's page. */
export interface LinkPageView {
  readonly team?: true;
  readonly member?: string;
  readonly edit?: true;
}

/** Where the link page screens are, and what they may offer there. */
export interface LinkPagePlace {
  readonly isEmbedded: boolean;
  /** The address of a link page screen in this place. */
  readonly href: (view?: LinkPageView) => string;
  readonly canManageTeam: boolean;
  readonly workspaceName: string | undefined;
  /** Inside a partner's frame, the partner app's name. */
  readonly appName: string | undefined;
}

/** The place the link page screens are drawn in, for the workspace `slug`. */
export function useLinkPagePlace(slug: string): LinkPagePlace {
  const embedded = useContext(Place);
  // Read either way (hooks always run); the frame's own answer wins inside a partner's frame.
  const canInApp = useCan('link_pages.manage_team');
  const nameInApp = useWorkspaceName();
  const base = embedded?.base ?? `/w/${slug}/link-page`;
  const theme = embedded?.theme;
  return {
    isEmbedded: embedded !== undefined,
    href: (view = {}) => {
      const search = new URLSearchParams();
      if (view.team === true) search.set('team', 'true');
      if (view.member !== undefined) search.set('member', view.member);
      if (view.edit === true) search.set('edit', 'true');
      if (theme !== undefined) search.set('theme', theme);
      const query = search.toString();
      return query === '' ? base : `${base}?${query}`;
    },
    canManageTeam: embedded?.canManageTeam ?? canInApp,
    workspaceName: embedded?.workspaceName ?? nameInApp,
    appName: embedded?.appName,
  };
}
