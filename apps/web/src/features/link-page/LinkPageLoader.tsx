// Settings › Account › Profile's link page view (`?view=link-page`, spec 0051): its store loads with the view (never
// in the app's first load), its read starts at once, and the editor's own loading shape stands meanwhile.
import type { DataLayer, LinkPageStore, MyProfile } from '@crm/data';
import { useEffect, useState } from 'react';
import { LinkPagePending } from './LinkPagePending.tsx';
import { LinkPageScreen } from './LinkPageScreen.tsx';

/** Props for the link page view. */
export interface LinkPageLoaderProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
}

/** The link page editor once its store has loaded; its loading shape until then. */
export function LinkPageLoader({ data, slug, profile }: LinkPageLoaderProps) {
  const [store, setStore] = useState<LinkPageStore | undefined>(undefined);
  useEffect(() => {
    let isCurrent = true;
    void data.linkPage.load().then((loaded) => {
      if (!isCurrent) return;
      loaded.read(slug).catch(() => undefined);
      setStore(loaded);
    });
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);
  if (store === undefined) return <LinkPagePending />;
  return <LinkPageScreen key={profile.memberId} linkPage={store} slug={slug} profile={profile} />;
}
