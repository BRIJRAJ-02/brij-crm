// The look a block's draft is drawn in (spec 0060, AC-16): the editor's "How it looks" shows the block on the
// page's own ground, in its own font, buttons and colour, not the app's. The screen that opens an editor provides
// it; an editor drawn anywhere else (a test, a story) draws the draft with no look, as before.
import type { PageTheme } from '@crm/data';
import { LinkPage, type LinkPagePhotos, type LinkPageProps } from '@crm/ui';
import { createContext, useContext, type ReactNode } from 'react';

/** What a draft wears: the look's names, its photos and its colour's variables. */
export interface DraftLookValue {
  readonly theme: PageTheme;
  readonly photos: LinkPagePhotos;
  readonly variables: readonly (readonly [string, string])[];
}

const DraftLookContext = createContext<DraftLookValue | undefined>(undefined);

/** Every draft under it wears `look`. */
export function DraftLook({ look, children }: { readonly look: DraftLookValue; readonly children: ReactNode }) {
  return <DraftLookContext value={look}>{children}</DraftLookContext>;
}

/** A block's draft (`layout="blocks"`), in the page's own look when the screen gave one. */
export function DraftPage(props: LinkPageProps) {
  const look = useContext(DraftLookContext);
  return (
    <LinkPage
      {...props}
      {...(look === undefined ? {} : { theme: look.theme, photos: look.photos, variables: look.variables })}
    />
  );
}
