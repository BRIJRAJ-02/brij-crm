// Brief
// Purpose: a form's Settings tab (spec 0023, Settings tab), laid out as a settings page (spec 0026): one Card per group,
// each with a live summary of what it holds.
// Main task: change the words a visitor sees (into the draft: the preview beside shows them at once, live on Publish),
// what happens after someone sends it, and the settings that apply at once (name, address, owner).
// Leaves out: offering a meeting after a send (#59, shown once booking pages on forms work), round robin (#58), the
// look (beside the preview).
import type { FormDocument, FormView, MemberSummary } from '@crm/data';
import { Card, Field, Radio, RadioGroup, Select } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { sameDocument } from './draft.ts';
import { firstRefusal } from './refusals.ts';
import { strings } from './strings.ts';

/** Props for the Settings tab. */
export interface SettingsTabProps {
  readonly slug: string;
  readonly form: FormView;
  readonly draft: FormDocument;
  readonly members: readonly MemberSummary[];
  readonly isReadOnly: boolean;
  readonly onDraftChange: (next: FormDocument | ((before: FormDocument) => FormDocument)) => void;
  readonly onFormChange: (view: FormView) => void;
}

const NOBODY = 'nobody';

/** A web address without its scheme, for a summary ("acme.com/thanks"). */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/** Four Cards: Name and address, What visitors see, After someone sends it, Who handles the leads. */
export function SettingsTab({ slug, form, draft, members, isReadOnly, onDraftChange, onFormChange }: SettingsTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [name, setName] = useState(form.name);
  const [address, setAddress] = useState(form.publicKey);
  const [addressError, setAddressError] = useState<string | undefined>(undefined);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  // What each after send choice last held, so switching back and forth keeps what was typed.
  const [kept, setKept] = useState<{ readonly message: string; readonly url: string }>({
    message: draft.after.kind === 'message' ? draft.after.message : '',
    url: draft.after.kind === 'redirect' ? draft.after.url : 'https://',
  });

  /** A setting that applies at once: saved on blur, a toast only when it fails. */
  const apply = (
    settings: Parameters<typeof data.forms.updateSettings>[2],
    onRefused?: (message: string) => void,
    onDone?: () => void,
  ) => {
    data.forms.updateSettings(slug, form.id, settings).then(
      (view) => {
        onFormChange(view);
        onDone?.();
      },
      (error: unknown) => {
        const { message } = firstRefusal(error);
        if (onRefused === undefined) toasts.toast({ tone: 'danger', message: `${strings.settingsFailed} ${message}` });
        else onRefused(message);
      },
    );
  };

  const after = draft.after;
  const live = form.live;
  // Whether what a visitor sees differs from the live form: then it waits for Publish.
  const seenChanged =
    live !== undefined &&
    (draft.headline !== live.headline ||
      (draft.subheading ?? '') !== (live.subheading ?? '') ||
      draft.buttonText !== live.buttonText);
  const afterChanged = live !== undefined && !sameDocument({ ...draft, after }, { ...draft, after: live.after });
  const owner = members.find((member) => member.id === form.ownerMemberId)?.name;

  return (
    <>
      <Card title={strings.nameAndAddress} description={data.forms.hostedUrl(form.publicKey)}>
        <Field
          label={strings.name}
          hint={strings.nameHint}
          value={name}
          maxLength={80}
          isRequired
          isReadOnly={isReadOnly}
          onChange={(text) => {
            setName(text);
            setNameError(undefined);
          }}
          onBlur={() => {
            if (name.trim() === '') setNameError(strings.nameRequired);
            else if (name.trim() !== form.name) apply({ name: name.trim() }, setNameError);
          }}
          {...(nameError === undefined ? {} : { error: nameError })}
        />
        <Field
          label={strings.address}
          prefix="/f/"
          hint={strings.addressChangeWarning}
          value={address}
          maxLength={40}
          isRequired
          isReadOnly={isReadOnly}
          onChange={(text) => {
            setAddress(text.toLowerCase());
            setAddressError(undefined);
          }}
          onBlur={() => {
            if (address !== form.publicKey) {
              apply({ slug: address }, setAddressError, () => {
                toasts.toast({ tone: 'success', message: strings.addressChanged });
              });
            }
          }}
          {...(addressError === undefined ? {} : { error: addressError })}
        />
      </Card>
      <Card title={strings.whatVisitorsSee} description={seenChanged ? strings.waitsForPublish : strings.liveNow}>
        <Field
          label={strings.headline}
          placeholder={strings.headlineDefault}
          value={draft.headline}
          maxLength={120}
          isReadOnly={isReadOnly}
          onChange={(headline) => {
            onDraftChange((before) => ({ ...before, headline }));
          }}
        />
        <Field
          label={strings.subheadingOptional}
          value={draft.subheading ?? ''}
          maxLength={240}
          isReadOnly={isReadOnly}
          onChange={(subheading) => {
            onDraftChange((before) => ({ ...before, subheading }));
          }}
        />
        <Field
          label={strings.buttonText}
          placeholder={strings.buttonDefault}
          value={draft.buttonText}
          maxLength={40}
          isReadOnly={isReadOnly}
          onChange={(buttonText) => {
            onDraftChange((before) => ({ ...before, buttonText }));
          }}
        />
      </Card>
      <Card
        title={strings.afterSent}
        description={[
          after.kind === 'message'
            ? strings.showsMessage
            : shortUrl(after.url) === ''
              ? strings.noAddressYet
              : strings.sendsTo(shortUrl(after.url)),
          afterChanged ? strings.waitsForPublish : '',
        ]
          .filter((part) => part !== '')
          .join(' · ')}
      >
        <RadioGroup
          label={strings.afterChoice}
          orientation="horizontal"
          value={after.kind}
          isReadOnly={isReadOnly}
          onChange={(kind) => {
            if (kind === after.kind) return;
            // Keep what the other choice held, then bring back what this one held.
            setKept((before) =>
              after.kind === 'message' ? { ...before, message: after.message } : { ...before, url: after.url },
            );
            onDraftChange((before) => ({
              ...before,
              after:
                kind === 'redirect' ? { kind: 'redirect', url: kept.url } : { kind: 'message', message: kept.message },
            }));
          }}
        >
          <Radio value="message">{strings.showMessage}</Radio>
          <Radio value="redirect">{strings.sendToAddress}</Radio>
        </RadioGroup>
        {after.kind === 'redirect' ? (
          <Field
            label={strings.redirectUrl}
            hint={strings.redirectHint}
            type="url"
            value={after.url}
            isRequired
            isReadOnly={isReadOnly}
            onChange={(url) => {
              onDraftChange((before) => ({ ...before, after: { kind: 'redirect', url } }));
            }}
          />
        ) : (
          <Field
            label={strings.thankYou}
            hint={strings.thankYouHint}
            placeholder={strings.thankYouDefault}
            isMultiline
            showCounter
            value={after.message}
            maxLength={2_000}
            isReadOnly={isReadOnly}
            onChange={(message) => {
              onDraftChange((before) => ({
                ...before,
                after: { ...(before.after.kind === 'message' ? before.after : {}), kind: 'message', message },
              }));
            }}
          />
        )}
      </Card>
      <Card title={strings.whoHandles} description={owner ?? strings.nobodyYet}>
        <Select
          label={strings.owner}
          hint={strings.ownerHint}
          items={[
            { id: NOBODY, label: strings.nobody },
            ...members.map((member) => ({ id: member.id, label: member.name })),
          ]}
          value={form.ownerMemberId ?? NOBODY}
          isReadOnly={isReadOnly}
          onChange={(id) => {
            apply({ ownerMemberId: id === null || id === NOBODY ? null : id });
          }}
        />
      </Card>
    </>
  );
}
