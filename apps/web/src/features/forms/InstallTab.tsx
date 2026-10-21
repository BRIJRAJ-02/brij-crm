// Brief
// Purpose: a form's Install tab (spec 0023, 0023-embeds.md), in the order a person needs it: share the link, then put
// it on a website (in the page, a popup, or a corner button), then (rarely) the advanced ways for a developer.
// Main task: press Copy link, or pick how it shows and copy its snippet. Nothing else needs touching for it to work.
// Leaves out: a QR code and analytics; the booking page's own embed lives with the booking page.
import type { FormView } from '@crm/data';
import {
  Button,
  Callout,
  Card,
  CopyButton,
  DescriptionList,
  Disclosure,
  Field,
  SegmentedControl,
  Switch,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { RotateSecretDialog } from './FormConfirms.tsx';
import { firstRefusal } from './refusals.ts';
import { embedSnippet, EMBED_MODES, ownFormHtml, type EmbedMode } from './snippets.ts';
import { strings } from './strings.ts';

/** Props for the Install tab. */
export interface InstallTabProps {
  readonly slug: string;
  readonly form: FormView;
  readonly isReadOnly: boolean;
  readonly onFormChange: (view: FormView) => void;
}

/** Each mode's segment name and the line under its snippet. */
const MODE_WORDS: Readonly<Record<EmbedMode, { readonly label: string; readonly hint: string }>> = {
  inline: { label: strings.embedInline, hint: strings.embedInlineHint },
  popup: { label: strings.embedPopup, hint: strings.embedPopupHint },
  floating: { label: strings.embedFloating, hint: strings.embedFloatingHint },
};

/** The most sites a form lists (the contract's cap). */
const SITES_MAX = 20;

/** Hosts a developer's own machine answers on, where a site under work runs on plain http. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A site's origin as typed, or why it can't be one: https (http only on this machine), nothing after the host. */
export function siteOrigin(typed: string): { readonly origin?: string; readonly problem?: string } {
  const text = typed.trim();
  if (!URL.canParse(text)) return { problem: strings.siteNotHttps };
  const url = new URL(text);
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  if (!secure || url.username !== '' || url.password !== '') return { problem: strings.siteNotHttps };
  return { origin: url.origin };
}

/** Share your form, Put it on your website, then Advanced (closed): your own HTML, the sites and the secret. */
export function InstallTab({ slug, form, isReadOnly, onFormChange }: InstallTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const link = data.forms.hostedUrl(form.publicKey);
  const script = data.forms.embedUrl();
  const shown = form.live ?? form.draft;
  const [mode, setMode] = useState<EmbedMode>('inline');
  const embed = embedSnippet(
    script,
    {
      kind: 'form',
      publicKey: form.publicKey,
      title: shown.headline,
      theme: shown.look.colour,
      buttonText: shown.buttonText,
    },
    mode,
  );
  const own = ownFormHtml(form, script);
  const [site, setSite] = useState('');
  const [siteError, setSiteError] = useState<string | undefined>(undefined);
  const [isRevealed, setRevealed] = useState(false);
  const [isRotating, setRotating] = useState(false);

  const saveSites = (list: readonly string[]) =>
    data.forms.updateSettings(slug, form.id, { allowedOrigins: list }).then(
      (view) => {
        onFormChange(view);
        toasts.toast({ tone: 'success', message: strings.sitesSaved });
        return true;
      },
      (error: unknown) => {
        setSiteError(firstRefusal(error).message);
        return false;
      },
    );
  const addSite = () => {
    const { origin, problem } = siteOrigin(site);
    if (origin === undefined) {
      setSiteError(problem);
      return;
    }
    if (form.allowedOrigins.includes(origin)) {
      setSiteError(strings.siteTaken);
      return;
    }
    if (form.allowedOrigins.length >= SITES_MAX) {
      setSiteError(strings.sitesFull);
      return;
    }
    void saveSites([...form.allowedOrigins, origin]).then((saved) => {
      if (saved) setSite('');
    });
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
      {/* One way to copy: the code block's own Copy, as the owner asked (no second button under it). */}
      <Card title={strings.websiteTitle} description={strings.websiteText}>
        <SegmentedControl
          label={strings.embedMode}
          segments={EMBED_MODES.map((each) => ({ value: each, label: MODE_WORDS[each].label }))}
          value={mode}
          onChange={(value) => {
            const next = EMBED_MODES.find((each) => each === value);
            if (next !== undefined) setMode(next);
          }}
        />
        <Field
          label={strings.embedSnippet}
          hint={MODE_WORDS[mode].hint}
          variant="copy"
          isMultiline
          copyLabel={strings.copyEmbed}
          value={embed}
        />
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
          <Callout tone="info" title={strings.taggingTitle}>
            <p>{strings.taggingText}</p>
            <p>{strings.taggingConsent}</p>
          </Callout>
        </Card>
        <Card
          title={strings.sitesTitle}
          description={strings.sitesText}
          {...(isReadOnly
            ? {}
            : {
                footer: (
                  <Button icon="plus" onPress={addSite}>
                    {strings.siteAdd}
                  </Button>
                ),
              })}
        >
          {form.allowedOrigins.length === 0 ? (
            <Callout tone="warning">{strings.sitesEmpty}</Callout>
          ) : (
            <DescriptionList
              items={form.allowedOrigins.map((origin) => ({
                term: origin,
                description: isReadOnly ? (
                  ''
                ) : (
                  <Button
                    icon="x"
                    variant="ghost"
                    label={strings.siteRemove(origin)}
                    onPress={() => {
                      void saveSites(form.allowedOrigins.filter((each) => each !== origin));
                    }}
                  />
                ),
              }))}
            />
          )}
          {!isReadOnly && (
            <Field
              label={strings.siteNew}
              hint={strings.siteNewHint}
              type="url"
              inputMode="url"
              value={site}
              onChange={(text) => {
                setSite(text);
                setSiteError(undefined);
              }}
              onSubmit={addSite}
              {...(siteError === undefined ? {} : { error: siteError })}
            />
          )}
        </Card>
        <Card title={strings.refuseUnsigned} description={strings.refuseUnsignedHint}>
          <Switch
            label={strings.refuseUnsigned}
            isLabelHidden
            isSelected={form.requireSignature}
            isReadOnly={isReadOnly}
            onChange={(requireSignature) => {
              data.forms.updateSettings(slug, form.id, { requireSignature }).then(onFormChange, (error: unknown) => {
                toasts.toast({ tone: 'danger', message: firstRefusal(error).message });
              });
            }}
          />
          <Disclosure title={strings.signHowTitle}>
            <p>{strings.signHowText}</p>
          </Disclosure>
          {form.signingSecret !== undefined && (
            <>
              <Field
                label={strings.secret}
                variant="copy"
                type={isRevealed ? 'text' : 'password'}
                copyLabel={strings.copySecret}
                hint={strings.secretReason}
                value={form.signingSecret}
              />
              <Button
                icon={isRevealed ? 'eye-off' : 'eye'}
                onPress={() => {
                  setRevealed((shown) => !shown);
                }}
              >
                {isRevealed ? strings.secretHide : strings.secretReveal}
              </Button>
              {!isReadOnly && (
                <Button
                  icon="refresh-cw"
                  variant="ghost-danger"
                  onPress={() => {
                    setRotating(true);
                  }}
                >
                  {strings.secretRotate}
                </Button>
              )}
            </>
          )}
        </Card>
      </Disclosure>
      <RotateSecretDialog
        data={data}
        slug={slug}
        form={isRotating ? { id: form.id, name: form.name, submissionCount: form.submissionCount } : undefined}
        onClose={() => {
          setRotating(false);
        }}
        onDone={(_form, view) => {
          setRotating(false);
          setRevealed(false);
          onFormChange(view);
          toasts.toast({ tone: 'success', message: strings.secretRotated });
        }}
      />
    </>
  );
}
