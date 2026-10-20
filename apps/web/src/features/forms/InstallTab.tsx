// Brief
// Purpose: a form's Install tab (spec 0023, Install tab): the three ways to put it in front of people, one at a time.
// Main task: pick Link, Embed or Your own HTML, then copy what it gives; for your own HTML, list the sites that may post.
// Leaves out: analytics, a QR code, and signing posts for a site (the site's server does that with the secret).
import type { FormView } from '@crm/data';
import { Button, Card, Disclosure, Field, SegmentedControl, Switch } from '@crm/ui';
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

type Way = 'link' | 'embed' | 'own';

/** One Card to share the form (Link, Embed, Your own HTML), and for your own HTML the sites that may post. */
export function InstallTab({ slug, form, isReadOnly, onFormChange }: InstallTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const link = data.forms.hostedUrl(form.publicKey);
  const script = data.forms.embedUrl();
  const embed = embedSnippet(script, form.publicKey, (form.live ?? form.draft).headline);
  const own = ownFormHtml(form, script);
  const [way, setWay] = useState<Way>('link');
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

  const siteCount = form.allowedOrigins.length;

  return (
    <>
      <Card title={strings.shareTitle} description={strings.wayText[way]}>
        <SegmentedControl
          label={strings.shareHow}
          segments={[
            { value: 'link', label: strings.wayLink },
            { value: 'embed', label: strings.wayEmbed },
            { value: 'own', label: strings.wayOwn },
          ]}
          value={way}
          onChange={(next) => {
            if (next === 'link' || next === 'embed' || next === 'own') setWay(next);
          }}
        />
        {way === 'link' && (
          <>
            <Field label={strings.link} variant="copy" copyLabel={strings.copyLink} value={link} />
            <Button
              icon="external-link"
              onPress={() => {
                window.open(link, '_blank', 'noopener');
              }}
            >
              {strings.openLink}
            </Button>
          </>
        )}
        {way === 'embed' && (
          <Field label={strings.embedSnippet} variant="copy" isMultiline copyLabel={strings.copyEmbed} value={embed} />
        )}
        {way === 'own' && (
          // The form HTML runs long: it waits behind a Disclosure, and its copy row's Copy takes it all.
          <Disclosure title={strings.showFormHtml}>
            <Field
              label={strings.ownFormSnippet}
              variant="copy"
              isMultiline
              copyLabel={strings.copyFormHtml}
              value={own}
            />
          </Disclosure>
        )}
      </Card>
      {way === 'own' && (
        <Card title={strings.sites} description={siteCount === 0 ? strings.noSitesYet : strings.siteCount(siteCount)}>
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
      )}
    </>
  );
}
