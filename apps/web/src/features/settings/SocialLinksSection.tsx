// Brief
// Purpose: Settings › Profile's Social links (booking socials, 25 Oct 2026): the person's own links, the same in every
// workspace, drafted here and saved with the page's SaveBar like the handle and bio.
// Main task: add, fill in, order and remove links; the page's Save sends them with the rest.
// Leaves out: saving itself (ProfileScreen's SaveBar), and the store (the page's save answers with the set). Loaded on
// its own (socials-slot.tsx), with the editor, out of the app's first load.
import type { SocialLink } from '@crm/data';
import {
  isSocialLinksDraftChanged,
  SettingsSection,
  SocialLinksEditor,
  socialLinksDraftOf,
  socialLinksOfDraft,
  type SocialLinkDraft,
} from '@crm/ui';
import { useEffect, useState } from 'react';
import type { SocialsDraftControl, SocialsDraftState } from './socials-slot.tsx';
import { strings } from './socials-strings.ts';

/** Props for SocialLinksSection. */
export interface SocialLinksSectionProps {
  /** The set as saved: the draft starts from it, and a save that lands makes it the draft's base again. */
  readonly saved: readonly SocialLink[];
  /** While the page's save is out. */
  readonly isSaving: boolean;
  /** Each change to whether the draft differs from the saved set, or has a row that won't save. */
  readonly onDraft: (state: SocialsDraftState) => void;
  /** Where the page reaches the draft: what to save, and Discard. */
  readonly controlRef: { current: SocialsDraftControl | undefined };
  /** Any edit, so the page clears its last save's word. */
  readonly onEdit: () => void;
}

/** The section: SocialLinksEditor over a draft of the person's set. */
export function SocialLinksSection({ saved, isSaving, onDraft, controlRef, onEdit }: SocialLinksSectionProps) {
  const [rows, setRows] = useState<readonly SocialLinkDraft[]>(() => socialLinksDraftOf(saved));
  const [errorFocus, setErrorFocus] = useState(0);
  const isChanged = isSocialLinksDraftChanged(rows, saved);
  const hasError = rows.some((row) => row.error !== undefined);
  useEffect(() => {
    onDraft({ isChanged, hasError });
  }, [isChanged, hasError, onDraft]);
  useEffect(() => {
    controlRef.current = {
      collect: () => {
        if (!isChanged) return undefined;
        const checked = socialLinksOfDraft(rows);
        if (checked.ok) return checked.links;
        // Every row that won't save now says why, and the first takes focus.
        setRows(checked.rows);
        setErrorFocus((count) => count + 1);
        return 'wrong';
      },
      discard: () => {
        setRows(socialLinksDraftOf(saved));
      },
    };
    return () => {
      controlRef.current = undefined;
    };
  }, [controlRef, isChanged, rows, saved]);
  return (
    <SettingsSection title={strings.section} description={strings.text}>
      <SocialLinksEditor
        rows={rows}
        isDisabled={isSaving}
        errorFocus={errorFocus}
        onChange={(next) => {
          setRows(next);
          onEdit();
        }}
      />
    </SettingsSection>
  );
}
