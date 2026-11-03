// Brief
// Purpose: who the link page is from (3 Nov 2026, the owner's reference page): the person's title, their company,
// and a line of their own, each off until they choose it.
// Main task: switch the job title on, give the company's site, and write the closing line; each saves on its own.
// Leaves out: the job title's words and the logo, which live in Profile and Brand, and anything that replaces
// "Powered by Timefix": the closing line sits above it.
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { Card, Field, Switch } from '@crm/ui';
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

/** Props for IdentityCard. */
export interface IdentityCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Their job title in this workspace, from Profile; absent when they set none. */
  readonly jobTitle?: string | undefined;
  readonly identity: PageIdentity;
  /** A change the server kept, so the phone beside the editor shows it. */
  readonly onSaved: (identity: PageIdentity) => void;
}

type Part = keyof PageIdentity;

/**
 * Who the page is from. The switch saves the moment it moves, as every switch on this screen does; each field saves
 * when it is left or Enter is pressed, and only when it changed. A refusal stays on its own field (or under the
 * switch) until the next try, and the field keeps what was typed so it can be put right.
 */
export function IdentityCard({ data, slug, jobTitle, identity, onSaved }: IdentityCardProps) {
  const [site, setSite] = useState(identity.site);
  const [footLine, setFootLine] = useState(identity.footLine);
  const [problems, setProblems] = useState<Partial<Record<Part, string>>>({});
  const save = (part: Part, value: boolean | string) => {
    if (identity[part] === value) return;
    setProblems((held) => ({ ...held, [part]: undefined }));
    data.profile.update(slug, { [part]: value }).then(
      (saved) => {
        const kept = identityOf(saved);
        if (part === 'site') setSite(kept.site);
        if (part === 'footLine') setFootLine(kept.footLine);
        onSaved(kept);
      },
      (error: unknown) => {
        setProblems((held) => ({ ...held, [part]: isDataError(error) ? error.message : strings.identityFailed }));
      },
    );
  };
  const hasTitle = jobTitle !== undefined && jobTitle !== '';
  return (
    <Card title={strings.identity} description={strings.identityText}>
      <Switch
        label={strings.showJobTitle}
        description={problems.showJobTitle ?? (hasTitle ? jobTitle : strings.noJobTitle)}
        isSelected={identity.showJobTitle}
        isDisabled={!hasTitle && !identity.showJobTitle}
        onChange={(next) => save('showJobTitle', next)}
      />
      <Field
        label={strings.site}
        type="url"
        inputMode="url"
        autoComplete="url"
        placeholder={strings.sitePlaceholder}
        hint={strings.siteHint}
        value={site}
        onChange={setSite}
        onBlur={() => save('site', site.trim())}
        onSubmit={() => save('site', site.trim())}
        {...(problems.site === undefined ? {} : { error: problems.site })}
      />
      <Field
        label={strings.footLine}
        placeholder={strings.footLinePlaceholder}
        hint={strings.footLineHint}
        maxLength={80}
        value={footLine}
        onChange={setFootLine}
        onBlur={() => save('footLine', footLine.trim())}
        onSubmit={() => save('footLine', footLine.trim())}
        {...(problems.footLine === undefined ? {} : { error: problems.footLine })}
      />
    </Card>
  );
}
