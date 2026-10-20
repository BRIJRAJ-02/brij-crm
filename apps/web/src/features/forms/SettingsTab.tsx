// Brief
// Purpose: a form's Settings tab (spec 0023, 0023-experience.md, Settings tab): the basics, what happens after someone sends it, who handles the leads.
// Main task: change the words a visitor sees (into the draft, live on Publish) and the settings that apply at once (name, address, owner).
// Leaves out: round robin (#58), booking pages (#59; Offer a meeting waits for them), the look (beside the preview).
import type { FormDocument, FormView, MemberSummary } from '@crm/data';
import { Card, Checkbox, Field, Select } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
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

/** Three Cards: The basics, After someone sends it, Who handles the leads. */
export function SettingsTab({ slug, form, draft, members, isReadOnly, onDraftChange, onFormChange }: SettingsTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [name, setName] = useState(form.name);
  const [address, setAddress] = useState(form.publicKey);
  const [addressError, setAddressError] = useState<string | undefined>(undefined);

  /** A setting that applies at once: saved on blur, a toast only when it fails. */
  const apply = (settings: Parameters<typeof data.forms.updateSettings>[2], onRefused?: (message: string) => void) => {
    data.forms.updateSettings(slug, form.id, settings).then(onFormChange, (error: unknown) => {
      const { message } = firstRefusal(error);
      if (onRefused === undefined) toasts.toast({ tone: 'danger', message: `${strings.settingsFailed} ${message}` });
      else onRefused(message);
    });
  };

  const after = draft.after;
  const isRedirect = after.kind === 'redirect';

  return (
    <>
      <Card title={strings.basics} description={strings.draftNote}>
        <Field
          label={strings.name}
          value={name}
          maxLength={80}
          isReadOnly={isReadOnly}
          onChange={setName}
          onBlur={() => {
            if (name.trim() !== '' && name.trim() !== form.name) apply({ name: name.trim() });
          }}
        />
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
          label={strings.subheading}
          hint={strings.subheadingHint}
          value={draft.subheading ?? ''}
          maxLength={240}
          isReadOnly={isReadOnly}
          onChange={(subheading) => {
            onDraftChange((before) => ({ ...before, subheading }));
          }}
        />
        <Field
          label={strings.address}
          prefix="/f/"
          hint={strings.addressChangeWarning}
          value={address}
          maxLength={40}
          isReadOnly={isReadOnly}
          onChange={(text) => {
            setAddress(text.toLowerCase());
            setAddressError(undefined);
          }}
          onBlur={() => {
            if (address !== form.publicKey) apply({ slug: address }, setAddressError);
          }}
          {...(addressError === undefined ? {} : { error: addressError })}
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
      <Card title={strings.afterSent}>
        <Checkbox
          label={strings.sendToAddress}
          isSelected={isRedirect}
          isReadOnly={isReadOnly}
          onChange={(redirect) => {
            onDraftChange((before) => ({
              ...before,
              after: redirect ? { kind: 'redirect', url: 'https://' } : { kind: 'message', message: '' },
            }));
          }}
        />
        {after.kind === 'redirect' ? (
          <Field
            label={strings.redirectUrl}
            hint={strings.redirectHint}
            type="url"
            value={after.url}
            isReadOnly={isReadOnly}
            onChange={(url) => {
              onDraftChange((before) => ({ ...before, after: { kind: 'redirect', url } }));
            }}
          />
        ) : (
          <>
            <Field
              label={strings.thankYou}
              hint={strings.thankYouHint}
              placeholder={strings.thankYouDefault}
              isMultiline
              value={after.message}
              maxLength={2_000}
              isReadOnly={isReadOnly}
              onChange={(message) => {
                onDraftChange((before) => ({ ...before, after: { kind: 'message', message } }));
              }}
            />
            <Checkbox label={strings.offerMeeting} description={strings.offerMeetingSoon} isDisabled />
            <Select label={strings.whichBookingPage} items={[]} placeholder={strings.chooseBookingPage} isDisabled />
          </>
        )}
      </Card>
      <Card title={strings.whoHandles}>
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
