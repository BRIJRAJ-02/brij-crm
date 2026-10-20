// Brief
// Purpose: a form's Install tab (spec 0023), in the order a person needs it: share the link, then put it on a
// website, then (rarely) the advanced ways for a developer.
// Main task: press Copy link. Embedding is one snippet to paste; nothing else needs touching for the form to work.
// Leaves out: a QR code and the popup or button embeds (the 19 October revision keeps one inline embed; embed.js has
// no other mode), and analytics.
import type { FormView } from '@crm/data';
import { Button, Card, CopyButton, Disclosure, Field, Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { firstRefusal } from './refusals.ts';
import { embedSnippet, ownFormHtml } from './snippets.ts';
import { strings } from './strings.ts';

/** Props for the Install tab. */
export interface InstallTabProps {
  readonly slug: string;
  readonly form: FormView;
  readonly isReadOnly: boolean;
  readonly onFormChange: (view: FormView) => void;
}

/** Share your form, Put it on your website, then Advanced (closed): your own HTML, the sites and the secret. */
export function InstallTab({ slug, form, isReadOnly, onFormChange }: InstallTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const link = data.forms.hostedUrl(form.publicKey);
  const script = data.forms.embedUrl();
  const embed = embedSnippet(script, form.publicKey, (form.live ?? form.draft).headline);
  const own = ownFormHtml(form, script);
  const [sites, setSites] = useState(form.allowedOrigins.join('\n'));
  const [sitesError, setSitesError] = useState<string | undefined>(undefined);

  const saveSites = () => {
    const list = sites
      .split(/\s+/)
      .map((site) => site.trim())
      .filter((site) => site !== '');
    if (list.join('\n') === form.allowedOrigins.join('\n')) return;
    data.forms.updateSettings(slug, form.id, { allowedOrigins: list }).then(
      (view) => {
        setSites(view.allowedOrigins.join('\n'));
        onFormChange(view);
        toasts.toast({ tone: 'success', message: strings.sitesSaved });
      },
      (error: unknown) => {
        setSitesError(firstRefusal(error).message);
      },
    );
  };

  return (
    <>
      <Card
        title={strings.shareTitle}
        description={link}
        footer={
          <>
            <CopyButton value={link} label={strings.copyLink} variant="primary" />
            <Button
              icon="external-link"
              onPress={() => {
                window.open(link, '_blank', 'noopener');
              }}
            >
              {strings.openLink}
            </Button>
          </>
        }
      />
      <Card
        title={strings.websiteTitle}
        description={strings.websiteText}
        footer={<CopyButton value={embed} label={strings.copyEmbed} variant="primary" />}
      >
        <Field label={strings.embedSnippet} variant="copy" isMultiline copyLabel={strings.copyEmbed} value={embed} />
      </Card>
      <Disclosure title={strings.advancedTitle}>
        <Card title={strings.ownFormTitle} description={strings.advancedText}>
          <Field
            label={strings.ownFormSnippet}
            variant="copy"
            isMultiline
            copyLabel={strings.copyFormHtml}
            value={own}
          />
          <Field
            label={strings.sitesLabel}
            hint={strings.sitesHint}
            isMultiline
            value={sites}
            isReadOnly={isReadOnly}
            onChange={(text) => {
              setSites(text);
              setSitesError(undefined);
            }}
            onBlur={saveSites}
            {...(sitesError === undefined ? {} : { error: sitesError })}
          />
          <Switch
            label={strings.refuseUnsigned}
            description={strings.refuseUnsignedHint}
            isSelected={form.requireSignature}
            isReadOnly={isReadOnly}
            onChange={(requireSignature) => {
              data.forms.updateSettings(slug, form.id, { requireSignature }).then(onFormChange, (error: unknown) => {
                toasts.toast({ tone: 'danger', message: firstRefusal(error).message });
              });
            }}
          />
          {form.signingSecret !== undefined && (
            <Field
              label={strings.secret}
              variant="copy"
              copyLabel={strings.copySecret}
              hint={strings.secretReason}
              value={form.signingSecret}
            />
          )}
        </Card>
      </Disclosure>
    </>
  );
}
