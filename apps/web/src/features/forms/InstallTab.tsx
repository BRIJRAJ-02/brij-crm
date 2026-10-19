// Brief
// Purpose: a form's Install tab (spec 0023, 0023-experience.md, Install tab): the three ways to use it.
// Main task: copy the link, the embed snippet or a form of your own, and list the sites that may post.
// Leaves out: analytics, and signing posts for a site (the site's server does that with the secret).
import type { FormView } from '@crm/data';
import { Button, Card, Code, CopyButton, Field, Switch } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { firstRefusal } from './refusals.ts';
import { strings } from './strings.ts';

/** Props for the Install tab. */
export interface InstallTabProps {
  readonly slug: string;
  readonly form: FormView;
  readonly isReadOnly: boolean;
  readonly onFormChange: (view: FormView) => void;
}

/** A plain HTML form for the site's own design: one field per question, named by `data-crm-field`. */
function ownFormHtml(form: FormView, script: string): string {
  const inputType = (type: string) =>
    type === 'email' ? 'email' : type === 'phone' ? 'tel' : type === 'website' ? 'url' : 'text';
  const fields = form.draft.questions.map((question) => {
    const required = question.required ? ' required' : '';
    if (question.answerType === 'long_text') {
      return `  <label>${question.label}\n    <textarea data-crm-field="${question.key}"${required}></textarea>\n  </label>`;
    }
    if (question.answerType === 'checkbox' || question.answerType === 'yes_no') {
      return `  <label><input type="checkbox" data-crm-field="${question.key}"${required}> ${question.label}</label>`;
    }
    if (question.answerType === 'dropdown' || question.answerType === 'choice') {
      const options = (question.choices ?? []).map((choice) => `      <option>${choice}</option>`).join('\n');
      return `  <label>${question.label}\n    <select data-crm-field="${question.key}"${required}>\n${options}\n    </select>\n  </label>`;
    }
    return `  <label>${question.label}\n    <input type="${inputType(question.answerType)}" data-crm-field="${question.key}"${required}>\n  </label>`;
  });
  return [
    `<form data-crm-form-post="${form.publicKey}">`,
    ...fields,
    `  <button type="submit">${form.draft.buttonText}</button>`,
    `  <p data-crm-thanks hidden>Thank you. That is with us.</p>`,
    '</form>',
    `<script src="${script}" async></script>`,
  ].join('\n');
}

/** Three Cards: Share a link, Embed on your site, Your own form. */
export function InstallTab({ slug, form, isReadOnly, onFormChange }: InstallTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const link = data.forms.hostedUrl(form.publicKey);
  const script = data.forms.embedUrl();
  const embed = `<script src="${script}" async></script>\n<div data-crm-form="${form.publicKey}"></div>`;
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
          <>
            <CopyButton value={link} label={strings.copy} />
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
      >
        <Code>{link}</Code>
      </Card>
      <Card
        title={strings.embed}
        description={strings.embedText}
        actions={<CopyButton value={embed} label={strings.copy} />}
      >
        <Field label={strings.embedSnippet} isMultiline isReadOnly value={embed} />
      </Card>
      <Card
        title={strings.ownForm}
        description={strings.ownFormText}
        actions={<CopyButton value={own} label={strings.copy} />}
      >
        <Field label={strings.ownFormSnippet} isMultiline isReadOnly value={own} />
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
          <Field
            label={strings.secret}
            value={form.signingSecret}
            isReadOnly
            suffix={<CopyButton value={form.signingSecret} label={strings.copy} isIconOnly />}
          />
        )}
      </Card>
    </>
  );
}
