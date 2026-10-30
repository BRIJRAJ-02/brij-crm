// Brief
// Purpose: a form's Install tab (spec 0023, 0023-embeds.md), in the order a person needs it: share the link, then put
// it on a website (in the page, a popup, or a corner button, picked as tiles), then the developer material, closed.
// Main task: press Copy link, or pick how it shows and copy its snippet. Nothing else needs touching for it to work.
// Leaves out: a QR code and analytics; the booking page's own embed lives with the booking page.
import type { FormView } from '@crm/data';
import {
  Button,
  Card,
  Code,
  DescriptionList,
  Disclosure,
  Field,
  InfoTip,
  Switch,
  TileGrid,
  type ChoiceTile,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { RemoveSiteDialog, RotateSecretDialog } from './FormConfirms.tsx';
import { firstRefusal } from './refusals.ts';
import { embedSnippet, ownFormHtml, type EmbedMode } from './snippets.ts';
import { strings } from './strings.ts';

/** Props for the Install tab. */
export interface InstallTabProps {
  readonly slug: string;
  readonly form: FormView;
  readonly isReadOnly: boolean;
  readonly onFormChange: (view: FormView) => void;
}

/**
 * The three ways a site shows the form, as tiles picked by sight (spec 0058, AC-11), in `EMBED_MODES` order: each a
 * small picture and a name, what the visitor sees in its tooltip. The Install tab and the first publish's Ready panel
 * draw the same tiles. The pictures are marks the icon registry already holds (each new mark costs every page's first
 * load).
 */
export const EMBED_TILES: readonly (ChoiceTile & { readonly id: EmbedMode })[] = [
  { id: 'inline', name: strings.embedInline, icon: 'file-text', description: strings.embedInlineHint },
  { id: 'popup', name: strings.embedPopup, icon: 'layers', description: strings.embedPopupHint },
  { id: 'floating', name: strings.embedFloating, icon: 'message-square', description: strings.embedFloatingHint },
];

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

/** Share, Put it on your site (the embed tiles and the snippet), then For developers, closed: own HTML, sites, secret. */
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
      // A button on a site's page reads as an invitation, not as the form's own Submit.
      buttonText: strings.embedButtonText,
    },
    mode,
  );
  const own = ownFormHtml(form, script);
  const [site, setSite] = useState('');
  const [siteError, setSiteError] = useState<string | undefined>(undefined);
  const [isRevealed, setRevealed] = useState(false);
  const [isRotating, setRotating] = useState(false);
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  // One change to the sites or the switch at a time, so each builds on the last saved list.
  const [saving, setSaving] = useState<'sites' | 'unsigned' | undefined>(undefined);

  /** Saves the list; resolves with the saved form, rejects with the refusal. */
  const saveSites = (list: readonly string[]) => {
    setSaving('sites');
    return data.forms.updateSettings(slug, form.id, { allowedOrigins: list }).then(
      (view) => {
        setSaving(undefined);
        onFormChange(view);
        toasts.toast({ tone: 'success', message: strings.sitesSaved });
        return view;
      },
      (error: unknown) => {
        setSaving(undefined);
        throw error;
      },
    );
  };
  const addSite = () => {
    if (saving !== undefined) return;
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
    saveSites([...form.allowedOrigins, origin]).then(
      () => {
        setSite('');
      },
      (error: unknown) => {
        setSiteError(firstRefusal(error).message);
      },
    );
  };

  /** Code names inside help text, drawn so they read and copy exactly. */
  const code = (text: string) => <Code key={text}>{text}</Code>;

  return (
    <>
      {/* One compact row (the owner, 22 Oct 2026): Share with its help beside it, the link with Copy inside it, and
          Open; the same row as a booking page's Public link. Copy isn't the page's main action, so it isn't blue. */}
      <Card>
        <Field
          label={strings.shareTitle}
          info={<InfoTip label={strings.shareTitle}>{strings.shareTip}</InfoTip>}
          variant="copy"
          copyLabel={strings.copyLink}
          value={link}
          after={
            <Button
              icon="external-link"
              onPress={() => {
                window.open(link, '_blank', 'noopener');
              }}
            >
              {strings.openLink}
            </Button>
          }
        />
      </Card>
      {/* One way to copy: the code block's own Copy, as the owner asked (no second button under it). */}
      <Card title={strings.websiteTitle} actions={<InfoTip label={strings.websiteTitle}>{strings.websiteTip}</InfoTip>}>
        <TileGrid
          variant="choice"
          label={strings.embedMode}
          tiles={EMBED_TILES}
          value={mode}
          onChange={(id) => {
            const tile = EMBED_TILES.find((each) => each.id === id);
            if (tile !== undefined) setMode(tile.id);
          }}
        />
        <Field
          label={strings.embedSnippet}
          {...(mode === 'floating' ? { hint: strings.embedFloatingWords } : {})}
          variant="copy"
          isMultiline
          copyLabel={strings.copyEmbed}
          value={embed}
        />
      </Card>
      <Disclosure title={strings.advancedTitle}>
        <Card
          title={strings.ownFormTitle}
          actions={
            <InfoTip label={strings.ownFormTitle} example={<>{strings.taggingConsent(code)}</>}>
              {strings.taggingText}
            </InfoTip>
          }
        >
          <Field
            label={strings.ownFormSnippet}
            variant="copy"
            isMultiline
            copyLabel={strings.copyFormHtml}
            value={own}
          />
        </Card>
        <Card
          title={strings.sitesTitle}
          {...(form.allowedOrigins.length === 0 ? { description: strings.sitesEmpty } : {})}
          actions={<InfoTip label={strings.sitesTitle}>{strings.sitesTip}</InfoTip>}
          {...(isReadOnly
            ? {}
            : {
                footer: (
                  <Button icon="plus" isPending={saving === 'sites'} onPress={addSite}>
                    {strings.siteAdd}
                  </Button>
                ),
              })}
        >
          {form.allowedOrigins.length > 0 && (
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
                      if (saving === undefined) setRemoving(origin);
                    }}
                  />
                ),
              }))}
            />
          )}
          {!isReadOnly && (
            <Field
              label={strings.siteNew}
              placeholder={strings.siteNewPlaceholder}
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
        <Card
          title={strings.signedTitle}
          actions={
            <InfoTip label={strings.signedTitle} example={<>{strings.signHowText(code)}</>}>
              {strings.refuseUnsignedHint}
            </InfoTip>
          }
          {...(form.signingSecret === undefined
            ? {}
            : {
                // The secret's own actions, together under it: Reveal, then Rotate last.
                footer: (
                  <>
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
                        variant="danger"
                        onPress={() => {
                          setRotating(true);
                        }}
                      >
                        {strings.secretRotate}
                      </Button>
                    )}
                  </>
                ),
              })}
        >
          <Switch
            label={strings.refuseUnsigned}
            isSelected={form.requireSignature}
            isReadOnly={isReadOnly}
            onChange={(requireSignature) => {
              if (saving !== undefined) return;
              setSaving('unsigned');
              data.forms.updateSettings(slug, form.id, { requireSignature }).then(
                (view) => {
                  setSaving(undefined);
                  onFormChange(view);
                  toasts.toast({
                    tone: 'success',
                    message: requireSignature ? strings.unsignedRefused : strings.unsignedAllowed,
                  });
                },
                (error: unknown) => {
                  setSaving(undefined);
                  toasts.toast({ tone: 'danger', message: firstRefusal(error).message });
                },
              );
            }}
          />
          {form.signingSecret !== undefined && (
            <Field
              label={strings.secret}
              variant="copy"
              type={isRevealed ? 'text' : 'password'}
              copyLabel={strings.copySecret}
              hint={strings.secretReason}
              value={form.signingSecret}
            />
          )}
        </Card>
      </Disclosure>
      <RemoveSiteDialog
        site={removing}
        onRemove={(origin) => saveSites(form.allowedOrigins.filter((each) => each !== origin))}
        onClose={() => {
          setRemoving(undefined);
        }}
      />
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
