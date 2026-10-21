// The inbox's unread count in the browser tab's title (spec 0038, AC-1174):
// "(3) People · Timefix" while the person has unread notifications in this
// workspace, live, from the same data layer source as the sidebar's badge.
// It draws nothing; the title follows the page's h1 as before.
import { useInboxUnread } from '@crm/data/react';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect } from 'react';
import { currentTitle } from '../navigation/title.ts';

/** Keeps the workspace's unread count on the root element and in the title while the workspace is open. */
export function UnreadTitle({ slug }: { readonly slug: string }) {
  const { data } = useRouteContext({ from: '__root__' });
  const unread = useInboxUnread(data.inbox.unread(slug)) ?? 0;
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.unread = String(unread);
    document.title = currentTitle(document);
    return () => {
      delete root.dataset.unread;
      document.title = currentTitle(document);
    };
  }, [unread]);
  return null;
}
