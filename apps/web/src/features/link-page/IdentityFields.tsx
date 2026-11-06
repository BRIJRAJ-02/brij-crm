// Brief
// Purpose: who the link page is from (3 Nov 2026, the owner's reference page): the person's title, their company,
// and a line of their own, each off until they choose it. Drawn inside the editor's one Details card (owner,
// 5 November 2026: two small cards of helpers read as noise), with no hint that restates its label.
// Main task: switch the job title on, give the company's site, and write the closing line; each saves on its own.
// Leaves out: the job title's words and the logo, which live in Profile and Brand (without a title, one link to
// Profile stands where a switch that can't move would), and anything that replaces "Powered by Timefix".
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { Field, Link, Switch } from '@crm/ui';
import { profileHref } from '../settings/nav.ts';
import { useLinkPagePlace } from './place.tsx';
import { useState } from 'react';
import { strings } from './strings.ts';

/** What the card holds, as the profile was read or last saved. */
export interface PageIdentity {
  readonly showJobTitle: boolean;
  readonly site: string;
  readonly footLine: string;
}

/** The three choices as a profile answers them: off, and empty, until the person makes them. */
export function identityOf(profile: MyProfile): PageIdentity {
  return {
    showJobTitle: profile.showJobTitle ?? false,
    site: profile.site ?? '',
    footLine: profile.footLine ?? '',
  };
}

/** Props for IdentityFields. */
export interface IdentityFieldsProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Their job title in this workspace, from Profile; absent when they set none. */
  readonly jobTitle?: string | undefined;
  readonly identity: PageIdentity;
  /** A change the server kept, so the phone beside the editor shows it. */
  readonly onSaved: (identity: PageIdentity) => void;
  /** Why the switch didn't save (undefined once it saves): the card it sits in says it in its foot. */
  readonly onSwitchRefused: (message: string | undefined) => void;
}

type Part = keyof PageIdentity;

/**
 * Who the page is from, as fields inside the Details card. The switch moves and saves the moment it is pressed, as every switch on this screen does, and
 * goes back if refused; each field saves when it is left or Enter is pressed, and only when it changed. A refusal
 * stays on its own field (or, for the switch, in the card's foot, as Sharing does) until the next try, and the field keeps what was typed so it can be put right.
 */
export function IdentityFields({ data, slug, jobTitle, identity, onSaved, onSwitchRefused }: IdentityFieldsProps) {
  const { isEmbedded } = useLinkPagePlace(slug);
  const [site, setSite] = useState(identity.site);
  const [footLine, setFootLine] = useState(identity.footLine);
  // The switch shows its new place the moment it is pressed, and goes back if the save is refused.
  const [switched, setSwitched] = useState<boolean | undefined>(undefined);
  const [problems, setProblems] = useState<Partial<Record<Part, string>>>({});
  const save = (part: Part, value: boolean | string) => {
    if (identity[part] === value) return;
    setProblems((held) => ({ ...held, [part]: undefined }));
    if (part === 'showJobTitle') onSwitchRefused(undefined);
    if (part === 'showJobTitle' && typeof value === 'boolean') setSwitched(value);
    data.profile.update(slug, { [part]: value }).then(
      (saved) => {
        const kept = identityOf(saved);
        if (part === 'site') setSite(kept.site);
        if (part === 'footLine') setFootLine(kept.footLine);
        if (part === 'showJobTitle') setSwitched(undefined);
        onSaved(kept);
      },
      (error: unknown) => {
        const said = isDataError(error) ? error.message : strings.identityFailed;
        if (part === 'showJobTitle') {
          setSwitched(undefined);
          onSwitchRefused(said);
        }
        setProblems((held) => ({ ...held, [part]: said }));
      },
    );
  };
  const hasTitle = jobTitle !== undefined && jobTitle !== '';
  return (
    <>
      {hasTitle || identity.showJobTitle ? (
        <Switch
          label={strings.showJobTitle}
          {...(hasTitle ? { description: jobTitle } : {})}
          isSelected={switched ?? identity.showJobTitle}
          onChange={(next) => save('showJobTitle', next)}
        />
      ) : isEmbedded ? undefined : (
        // No title to show: the way to add one, rather than a switch that can't move. Settings is no part of a
        // partner's frame (spec 0070, AC-7033), so there it is left out.
        <Link href={profileHref(slug)}>{strings.addJobTitle}</Link>
      )}
      <Field
        label={strings.site}
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder={strings.sitePlaceholder}
        value={site}
        onChange={setSite}
        onBlur={() => save('site', site.trim())}
        onSubmit={() => save('site', site.trim())}
        {...(problems.site === undefined ? {} : { error: problems.site })}
      />
      <Field
        label={strings.footLine}
        placeholder={strings.footLinePlaceholder}
        maxLength={80}
        value={footLine}
        onChange={setFootLine}
        onBlur={() => save('footLine', footLine.trim())}
        onSubmit={() => save('footLine', footLine.trim())}
        {...(problems.footLine === undefined ? {} : { error: problems.footLine })}
      />
    </>
  );
}
