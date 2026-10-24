// Settings › Profile's Social links section, where it stands (booking socials, 25 Oct 2026): the section's own module
// (SocialLinksSection.tsx, with the editor) loads on its own, out of the app's first load, started as this page's
// module loads, so it is usually here by the first paint. Until it is, its loading shape stands where it will: the
// saved rows' marks, their names and fields as skeletons.
// Main task: hold the section's place, and say how the page reaches its draft.
// Leaves out: the section itself (SocialLinksSection.tsx).
import type { SocialLink } from '@crm/data';
import { Card, Icon, ProviderMark, SettingsRow, SettingsSection, Skeleton } from '@crm/ui';
import { lazy, Suspense, type ComponentProps } from 'react';
import { strings } from './socials-strings.ts';

/** Whether the person's draft of their links differs from the saved set, and whether a row won't save. */
export interface SocialsDraftState {
  readonly isChanged: boolean;
  readonly hasError: boolean;
}

/** How the page reaches the section's draft. */
export interface SocialsDraftControl {
  /** The links to save: undefined when unchanged; `wrong` when a row won't save (each now says why, the first focused). */
  readonly collect: () => readonly SocialLink[] | 'wrong' | undefined;
  /** Puts the saved set back (the SaveBar's Discard). */
  readonly discard: () => void;
}

const loadSection = () => import('./SocialLinksSection.tsx').then((module) => ({ default: module.SocialLinksSection }));

// Started as soon as Profile's module loads: the section is part of the page, not an action on it.
const LazySection = lazy(loadSection);
void loadSection().catch(() => undefined);

/**
 * The section while its module loads: the saved links' rows (their marks and names) with skeletons for the fields,
 * the Add footer's place, or, before the profile is read, two rows' shapes.
 */
export function SocialLinksSectionPending({ saved }: { readonly saved?: readonly SocialLink[] }) {
  const rows =
    saved === undefined
      ? [0, 1].map((index) => (
          <SettingsRow key={index} title="" leading={<Skeleton shape="tile" />} control="field">
            <Skeleton shape="field" />
          </SettingsRow>
        ))
      : saved.map((link) => (
          <SettingsRow
            key={link.network}
            title=""
            leading={link.network === 'website' ? <Icon name="link" /> : <ProviderMark provider={link.network} />}
            control="field"
          >
            <Skeleton shape="field" />
          </SettingsRow>
        ));
  return (
    <SettingsSection title={strings.section} description={strings.text}>
      <Card isBusy {...(saved !== undefined && saved.length > 0 ? { footer: <Skeleton width="short" /> } : {})}>
        {saved !== undefined && saved.length === 0 ? <SettingsRow title="" description={<Skeleton />} /> : rows}
      </Card>
    </SettingsSection>
  );
}

/** The section, loaded on its own; its loading shape until then. */
export function SocialLinksSectionSlot(props: ComponentProps<typeof LazySection>) {
  return (
    <Suspense fallback={<SocialLinksSectionPending saved={props.saved} />}>
      <LazySection {...props} />
    </Suspense>
  );
}
