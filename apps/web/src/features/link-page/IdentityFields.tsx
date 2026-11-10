// Brief
// Purpose: who the link page is from (3 Nov 2026, the owner's reference page; 9 Nov 2026, "an option to change the
// name and an option to add title below the name"): the name at the top of the page, the title under it, their
// company's site, and a line of their own. Drawn in two parts (owner, 10 Nov 2026, Linktree style): the name, the
// title and its switch in the Profile card at the top, live on the page the moment each saves; the site and the
// closing line in Details at the end, which wait for Publish. No hint restates a label.
// Main task: change the name or the title right here, as on Linktree; each field saves on its own. A title typed here
// is meant to show, so it turns on; the switch under it stays only to keep a title to the team.
// Leaves out: the logo (Brand), and anything that replaces "Powered by Timefix". On someone else's page (spec 0070)
// only the name and title: a page only person's are the manager's to change; anyone with a login keeps their own.
import { isDataError, type DataLayer, type MyProfile } from '@crm/data';
import { Field, Switch } from '@crm/ui';
import { useState } from 'react';
import { strings } from './strings.ts';
import { teamStrings } from './team-strings.ts';

/** What the card holds, as the profile was read or last saved. */
export interface PageIdentity {
  /** The name at the top of the page. */
  readonly name: string;
  /** The title under it, empty when there is none. */
  readonly jobTitle: string;
  readonly showJobTitle: boolean;
  readonly site: string;
  readonly footLine: string;
}

/** The choices as a profile answers them: off, and empty, until the person makes them. */
export function identityOf(profile: MyProfile): PageIdentity {
  return {
    name: profile.name,
    jobTitle: profile.jobTitle ?? '',
    showJobTitle: profile.showJobTitle ?? false,
    site: profile.site ?? '',
    footLine: profile.footLine ?? '',
  };
}

/** Whose name the fields change: the caller's own, or a member's page a team page manager opened (spec 0070). */
export type IdentityOwner =
  | { readonly kind: 'own' }
  /** A page only person: the manager changes their name and title (`teamPages.namePerson`). */
  | { readonly kind: 'team'; readonly member: string }
  /** Someone who keeps their own (a login of their own, or a partner's app): shown, never changed here. */
  | { readonly kind: 'kept'; readonly by: 'self' | 'partner' };

/** Props for IdentityFields. */
export interface IdentityFieldsProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** Whose page; the caller's own when absent. */
  readonly owner?: IdentityOwner;
  /**
   * Which fields: `profile` (the default) the name, the title and Show under my name, live on save; `details` the
   * company site and the closing line, drafted until Publish. Someone else's page has the profile part only.
   */
  readonly part?: 'profile' | 'details';
  readonly identity: PageIdentity;
  /** A change the server kept, so the phone beside the editor shows it. */
  readonly onSaved: (identity: PageIdentity) => void;
  /** Why the switch didn't save (undefined once it saves): the card it sits in says it in its foot. */
  readonly onSwitchRefused: (message: string | undefined) => void;
}

type Part = keyof PageIdentity;

/** The change one field's new value sends, for the caller's own page. */
function ownChange(part: Part, value: boolean | string, identity: PageIdentity): Record<string, boolean | string> {
  if (part !== 'jobTitle' || typeof value !== 'string') return { [part]: value };
  // A first title typed here is meant to show under the name; one cleared has nothing to show, so it stops showing,
  // and a title given later (here or in Profile) never appears on the page unasked. A title reworded keeps the
  // switch where its owner left it: off keeps it to the team.
  const show = value === '' ? false : identity.jobTitle === '' ? true : identity.showJobTitle;
  return show === identity.showJobTitle ? { jobTitle: value } : { jobTitle: value, showJobTitle: show };
}

/**
 * Who the page is from, as fields inside the Details card. The switch moves and saves the moment it is pressed, as
 * every switch on this screen does, and goes back if refused; each field saves when it is left or Enter is pressed,
 * and only when it changed. A refusal stays on its own field (or, for the switch, in the card's foot, as Sharing
 * does) until the next try, and the field keeps what was typed so it can be put right.
 */
export function IdentityFields({
  data,
  slug,
  owner = { kind: 'own' },
  part = 'profile',
  identity,
  onSaved,
  onSwitchRefused,
}: IdentityFieldsProps) {
  const [drafts, setDrafts] = useState({
    name: identity.name,
    jobTitle: identity.jobTitle,
    site: identity.site,
    footLine: identity.footLine,
  });
  // The switch shows its new place the moment it is pressed, and goes back if the save is refused.
  const [switched, setSwitched] = useState<boolean | undefined>(undefined);
  const [problems, setProblems] = useState<Partial<Record<Part, string>>>({});
  // What each field last sent while its answer is out: Enter then Tab sends it once, not twice.
  const [sending, setSending] = useState<Partial<Record<Part, boolean | string>>>({});
  const draft = (part: keyof typeof drafts) => (value: string) => setDrafts((held) => ({ ...held, [part]: value }));
  const send = (part: Part, value: boolean | string): Promise<PageIdentity> => {
    if (owner.kind === 'team') {
      const change = part === 'name' ? { name: String(value) } : { jobTitle: String(value) };
      return data.teamPages.namePerson(slug, owner.member, change).then((named) => ({
        ...identity,
        name: named.name,
        jobTitle: named.jobTitle ?? '',
        showJobTitle: named.showJobTitle,
      }));
    }
    return data.profile.update(slug, ownChange(part, value, identity)).then(identityOf);
  };
  const save = (part: Part, value: boolean | string) => {
    if (identity[part] === value || sending[part] === value) return;
    // A page always has a name: an empty one is said on the field, and nothing is sent.
    if (part === 'name' && value === '') {
      setProblems((held) => ({ ...held, name: strings.nameRequired }));
      return;
    }
    setSending((held) => ({ ...held, [part]: value }));
    setProblems((held) => ({ ...held, [part]: undefined }));
    if (part === 'showJobTitle') onSwitchRefused(undefined);
    if (part === 'showJobTitle' && typeof value === 'boolean') setSwitched(value);
    send(part, value).then(
      (kept) => {
        setSending((held) => ({ ...held, [part]: undefined }));
        if (part !== 'showJobTitle') setDrafts((held) => ({ ...held, [part]: kept[part] }));
        else setSwitched(undefined);
        onSaved(kept);
      },
      (error: unknown) => {
        setSending((held) => ({ ...held, [part]: undefined }));
        const said = isDataError(error) ? error.message : strings.identityFailed;
        if (part === 'showJobTitle') {
          setSwitched(undefined);
          onSwitchRefused(said);
        }
        setProblems((held) => ({ ...held, [part]: said }));
      },
    );
  };
  /** A text field's own props: its draft, saved trimmed when left or on Enter, and its refusal. */
  const text = (part: keyof typeof drafts) => ({
    value: drafts[part],
    onChange: draft(part),
    onBlur: () => save(part, drafts[part].trim()),
    onSubmit: () => save(part, drafts[part].trim()),
    ...(problems[part] === undefined ? {} : { error: problems[part] }),
  });
  if (part === 'details' && owner.kind !== 'own') return null;
  if (part === 'details') {
    return (
      <>
        <Field
          label={strings.site}
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder={strings.sitePlaceholder}
          {...text('site')}
        />
        <Field
          label={strings.footLine}
          placeholder={strings.footLinePlaceholder}
          maxLength={80}
          {...text('footLine')}
        />
      </>
    );
  }
  if (owner.kind === 'kept') {
    // Theirs to change, in their own Profile (or their partner's app): shown so the manager sees what the page says.
    const reason = owner.by === 'partner' ? teamStrings.nameFromPartner : teamStrings.nameTheirs;
    // The title only as their page shows it: one kept to the team isn't the page's to show.
    const hasTitle = identity.jobTitle !== '' && identity.showJobTitle;
    // The reason once, under the last field, rather than the same line under each.
    return (
      <>
        <Field
          label={strings.name}
          value={identity.name}
          isReadOnly
          {...(hasTitle ? {} : { readOnlyReason: reason })}
        />
        {hasTitle && <Field label={strings.jobTitle} value={identity.jobTitle} isReadOnly readOnlyReason={reason} />}
      </>
    );
  }
  const nameAndTitle = (
    <>
      <Field label={strings.name} autoComplete="off" maxLength={80} {...text('name')} />
      <Field
        label={strings.jobTitle}
        autoComplete="off"
        placeholder={strings.jobTitlePlaceholder}
        maxLength={60}
        {...text('jobTitle')}
      />
    </>
  );
  if (owner.kind === 'team') return nameAndTitle;
  return (
    <>
      {nameAndTitle}
      {/* Only with a title to show: a switch with nothing under it can't mean anything. Off keeps the title to the
          team (Team day, the roster) and off the page. */}
      {identity.jobTitle !== '' && (
        <Switch
          label={strings.showJobTitle}
          isSelected={switched ?? identity.showJobTitle}
          onChange={(next) => save('showJobTitle', next)}
        />
      )}
    </>
  );
}
