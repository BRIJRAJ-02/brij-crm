// Brief
// Purpose: first run's Your workspace (spec 0036): the workspace's name and web address, the address checked as typed.
// Main task: name the workspace (it follows your name until edited), check its address, then Create workspace.
// Leaves out: a logo, templates and settings; the workspace can't be skipped, since everything lives in one.
import { Field, Form, Icon, Spinner, VisuallyHidden } from '@crm/ui';
import { useState } from 'react';
import { addressAsTyped, SLUG_MAX } from './names.ts';
import type { WelcomeRefusal } from './refusals.ts';
import { strings } from './strings.ts';
import type { Address } from './useAddress.ts';

const FIELDS = { name: 'name', slug: 'slug' } as const;

/** Props for Your workspace. */
export interface WorkspaceStepProps {
  /** The workspace's name: typed, or following your name. */
  readonly name: string;
  readonly onName: (name: string) => void;
  /** Its address (typed, picked, or the first free one made from the name), where it stands, and free ones to offer. */
  readonly address: Address;
  /** The address typed or picked. */
  readonly onSlug: (slug: string) => void;
  /** The workspace is being made. */
  readonly isCreating: boolean;
  /** The server's last refusals. */
  readonly refusals: readonly WelcomeRefusal[];
  /** Makes the workspace: called once the name is given and the address is neither broken nor known to be taken. */
  readonly onCreate: () => void;
}

/**
 * Your workspace: "Workspace name", "Web address" after a quiet "/w/" with
 * its check (a spinner while it asks, a tick and "Available", or "Taken" on
 * the field, announced), free suggestions under it to pick from when the
 * typed one is taken or the first choice was, and Create workspace (Enter).
 */
export function WorkspaceStep({ name, onName, address, onSlug, isCreating, refusals, onCreate }: WorkspaceStepProps) {
  const [problems, setProblems] = useState<readonly WelcomeRefusal[]>([]);
  const { slug, state, suggestions } = address;
  const hint =
    state === 'invalid'
      ? strings.addressRule
      : state === 'checking'
        ? strings.addressChecking
        : state === 'free'
          ? strings.addressFree
          : state === 'unknown'
            ? strings.addressUnknown
            : undefined;
  const create = () => {
    // A known taken address is refused here too, so the Form moves focus to it and says it again; Create waits.
    const found: WelcomeRefusal[] = [
      ...(name.trim() === '' ? [{ code: 'MISSING', message: strings.workspaceNameMissing, field: FIELDS.name }] : []),
      ...(state === 'invalid' ? [{ code: 'INVALID', message: strings.slugInvalid, field: FIELDS.slug }] : []),
      ...(state === 'taken'
        ? [{ code: 'SLUG_TAKEN', message: strings.addressTakenSaid(slug), field: FIELDS.slug }]
        : []),
    ];
    setProblems(found);
    if (found.length > 0) return;
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
          {...(suggestions.length === 0
            ? {}
            : { suggestions: { label: strings.addressSuggestions, items: suggestions, onPick: onSlug } })}
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
          {state === 'free'
            ? [
                strings.addressFreeSaid(slug),
                ...(suggestions.length > 0 ? [strings.addressOthers(suggestions)] : []),
              ].join(' ')
            : state === 'taken'
              ? [
                  strings.addressTakenSaid(slug),
                  ...(suggestions.length > 0 ? [strings.addressOthers(suggestions)] : []),
                ].join(' ')
              : ''}
        </span>
      </VisuallyHidden>
    </>
  );
}
