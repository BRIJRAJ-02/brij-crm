// Brief
// Purpose: first run's Your workspace (spec 0036): the workspace's name and web address, the address checked as typed.
// Main task: name the workspace (it follows your name until edited), check its address, then Create workspace.
// Leaves out: a logo, templates and settings; the workspace can't be skipped, since everything lives in one.
import type { DataLayer } from '@crm/data';
import { Field, Form, Icon, Spinner, VisuallyHidden } from '@crm/ui';
import { useEffect, useState } from 'react';
import { addressAsTyped, SLUG_MAX, SLUG_RULE } from './names.ts';
import type { WelcomeRefusal } from './refusals.ts';
import { strings } from './strings.ts';

/** How long after the last key the address is checked (spec 0036, AC-1207). */
export const SLUG_CHECK_DELAY_MS = 300;

const FIELDS = { name: 'name', slug: 'slug' } as const;

/** What the server last said about an address: free, taken, or no answer (offline, too many checks). */
interface Checked {
  readonly slug: string;
  readonly answer: 'free' | 'taken' | 'unknown';
}

/** Where the address stands: breaking the rule, being checked, or the check's answer. */
export type AddressState = 'invalid' | 'checking' | Checked['answer'];

/** Props for Your workspace. */
export interface WorkspaceStepProps {
  readonly data: DataLayer;
  /** The workspace's name: typed, or following your name. */
  readonly name: string;
  readonly onName: (name: string) => void;
  /** Its address: typed, or following the name. */
  readonly slug: string;
  readonly onSlug: (slug: string) => void;
  /** The workspace is being made. */
  readonly isCreating: boolean;
  /** The server's last refusals. */
  readonly refusals: readonly WelcomeRefusal[];
  /** Makes the workspace: called once the name is given and the address is neither broken nor known to be taken. */
  readonly onCreate: () => void;
}

/**
 * Your workspace: "Workspace name", "Web address" after "/w/" with its check
 * (a spinner while it asks, a tick and "That address is free.", or "That
 * address is taken. Try another." on the field, announced), and Create
 * workspace (Enter).
 */
export function WorkspaceStep({
  data,
  name,
  onName,
  slug,
  onSlug,
  isCreating,
  refusals,
  onCreate,
}: WorkspaceStepProps) {
  const [checked, setChecked] = useState<Checked | undefined>(undefined);
  const [problems, setProblems] = useState<readonly WelcomeRefusal[]>([]);
  // The address is asked about once typing stops; an answer for an older address is dropped.
  useEffect(() => {
    if (!SLUG_RULE.test(slug)) return;
    let isCurrent = true;
    const timer = setTimeout(() => {
      data.workspaces.slugAvailable(slug).then(
        (available) => {
          if (isCurrent) setChecked({ slug, answer: available ? 'free' : 'taken' });
        },
        () => {
          if (isCurrent) setChecked({ slug, answer: 'unknown' });
        },
      );
    }, SLUG_CHECK_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [slug, data]);
  const state: AddressState = !SLUG_RULE.test(slug) ? 'invalid' : checked?.slug === slug ? checked.answer : 'checking';
  const hint =
    state === 'invalid'
      ? strings.addressRule
      : state === 'checking'
        ? strings.addressChecking
        : state === 'free'
          ? strings.addressFree
          : undefined;
  const create = () => {
    const found: WelcomeRefusal[] = [
      ...(name.trim() === '' ? [{ code: 'MISSING', message: strings.workspaceNameMissing, field: FIELDS.name }] : []),
      ...(state === 'invalid' ? [{ code: 'INVALID', message: strings.slugInvalid, field: FIELDS.slug }] : []),
    ];
    setProblems(found);
    // A known taken address is said on its field already; Create waits for another.
    if (found.length > 0 || state === 'taken') return;
    onCreate();
  };
  return (
    <>
      <Form<WelcomeRefusal>
        submitLabel={strings.create}
        busyLabel={strings.creating}
        isBusy={isCreating}
        refusals={problems.length > 0 ? problems : refusals}
        fieldFor={(refusal) => refusal.field}
        onSubmit={create}
      >
        <Field
          label={strings.workspaceName}
          name={FIELDS.name}
          autoComplete="organization"
          isRequired
          maxLength={80}
          value={name}
          onChange={onName}
        />
        <Field
          label={strings.webAddress}
          name={FIELDS.slug}
          autoComplete="off"
          isRequired
          maxLength={SLUG_MAX}
          prefix={strings.addressPrefix}
          value={slug}
          onChange={(next) => {
            onSlug(addressAsTyped(next));
          }}
          {...(hint === undefined ? {} : { hint })}
          {...(state === 'taken' ? { error: strings.addressTaken } : {})}
          {...(state === 'checking'
            ? { suffix: <Spinner size="sm" label={strings.addressChecking} /> }
            : state === 'free'
              ? { suffix: <Icon name="circle-check" size="sm" tone="success" /> }
              : {})}
        />
      </Form>
      {/* The answer is said once it settles; the hint under the field carries it on screen. */}
      <VisuallyHidden>
        <span role="status">
          {state === 'free' ? strings.addressFreeSaid(slug) : state === 'taken' ? strings.addressTakenSaid(slug) : ''}
        </span>
      </VisuallyHidden>
    </>
  );
}
