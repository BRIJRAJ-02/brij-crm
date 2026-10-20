// Brief
// Purpose: a form's Install tab (spec 0023, 0023-experience.md, Install tab): the three ways to use it.
// Main task: copy the link, the embed snippet or a form of your own, and list the sites that may post.
// Leaves out: analytics, and signing posts for a site (the site's server does that with the secret).
import type { FormView } from '@crm/data';
import { Button, Card, Field, Switch } from '@crm/ui';
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

/** Three Cards: Share a link, Embed on your site, Your own form. */
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
        title={strings.shareLink}
        description={strings.shareLinkText}
        actions={
          <Button
            icon="external-link"
            onPress={() => {
              window.open(link, '_blank', 'noopener');
            }}
          >
            {strings.openLink}
          </Button>
        }
      >
        <Field label={strings.link} variant="copy" copyLabel={strings.copyLink} value={link} />
      </Card>
      <Card title={strings.embed} description={strings.embedText}>
        <Field label={strings.embedSnippet} variant="copy" isMultiline copyLabel={strings.copyEmbed} value={embed} />
      </Card>
      <Card title={strings.ownForm} description={strings.ownFormText}>
        <Field label={strings.ownFormSnippet} variant="copy" isMultiline copyLabel={strings.copyFormHtml} value={own} />
        <Field
          label={strings.sites}
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
          <Field label={strings.secret} variant="copy" copyLabel={strings.copySecret} value={form.signingSecret} />
        )}
      </Card>
    </>
  );
}
