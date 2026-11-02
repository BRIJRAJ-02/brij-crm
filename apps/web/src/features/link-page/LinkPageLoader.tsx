// Settings › Account › Profile's link page view (`?view=link-page`, spec 0051): its store loads with the view (never
// in the app's first load), its read starts at once, and the editor's own loading shape stands meanwhile.
import type { BrandStore, DataLayer, LinkPageStore, LinkPageSummary, MyProfile } from '@crm/data';
import { useEffect, useState } from 'react';
import { LinkPagePending } from './LinkPagePending.tsx';
import { LinkPageScreen } from './LinkPageScreen.tsx';

/** Props for the link page view. */
export interface LinkPageLoaderProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
  /** The person's link pages here (spec 0064), for the switcher; empty before the first handle. */
  readonly pages?: readonly LinkPageSummary[];
  /** The builder is open (`?edit`); without it the page opens on the overview. */
  readonly isEditing: boolean;
  readonly onEditing: (isEditing: boolean) => void;
  /** Opens another of the person's pages. */
  readonly onPick?: (page: string) => void;
  /** The pages changed: read them again, opening `open` when it is named. */
  readonly onPagesChanged?: (open?: string) => void;
}

/** The link page editor once its store has loaded; its loading shape until then. */
export function LinkPageLoader({
  data,
  slug,
  profile,
  pages = [],
  isEditing,
  onEditing,
  onPick,
  onPagesChanged,
}: LinkPageLoaderProps) {
  const [store, setStore] = useState<{ readonly linkPage: LinkPageStore; readonly brand: BrandStore } | undefined>(
    undefined,
  );
  useEffect(() => {
    let isCurrent = true;
    // The page's colour and photos load beside its blocks (spec 0060), so the phone wears them from the first paint.
    void Promise.all([data.linkPage.load(), data.brand.load()]).then(([linkPage, brand]) => {
      if (!isCurrent) return;
      linkPage.read(slug).catch(() => undefined);
      setStore({ linkPage, brand });
    });
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);
  if (store === undefined) return <LinkPagePending />;
  return (
    <LinkPageScreen
      // Another page is another screen: its blocks, look and figures are read afresh (spec 0064).
      key={`${profile.memberId}:${profile.profileId ?? ''}`}
      data={data}
      linkPage={store.linkPage}
      brand={store.brand}
      slug={slug}
      profile={profile}
      pages={pages}
      isEditing={isEditing}
      onEditing={onEditing}
      {...(onPick === undefined ? {} : { onPick })}
      {...(onPagesChanged === undefined ? {} : { onPagesChanged })}
    />
  );
}
