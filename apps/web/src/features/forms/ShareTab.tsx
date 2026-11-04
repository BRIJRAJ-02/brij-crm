// Brief
// Purpose: a form's Share tab (spec 0023, 0023-embeds.md; T44, b5 to b10, S4, S7), in the order a person needs it:
// the link (the link with Copy, the ways to send it, its QR code beside them; the same block as the live dialog), then
// put it on a site (three ways stacked as a column with their words, colour and look under them, a made up site beside
// it showing the pick, the snippet below), then the developer material in one quiet sheet.
// Main task: press Copy link, or pick how it shows and copy its snippet. Nothing else needs touching for it to work.
// Leaves out: analytics; the booking page's own embed lives with the booking page.
import { BRAND_QUICK_PICKS, type FormQuestion, type FormView } from '@crm/data';
import {
  AccentPicker,
  Button,
  Card,
  Code,
  DescriptionList,
  EmbedPreview,
  Field,
  InfoTip,
  Modal,
  SettingsStack,
  Switch,
  Table,
  TileGrid,
  type ChoiceTile,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { RemoveSiteDialog, RotateSecretDialog } from './FormConfirms.tsx';
import { firstRefusal } from './refusals.ts';
import { ShareBlock } from './ShareBlock.tsx';
import { embedSnippet, ownFormHtml, type EmbedMode } from './snippets.ts';
import { strings } from './strings.ts';

/** Props for the Share tab. */
export interface ShareTabProps {
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

/**
 * The corner button's quick colours: the brand picks less blue, which the first swatch (Accent, the product's own
 * blue) already is (the owner, 5 November 2026: two near identical blues side by side).
 */
const EMBED_PICKS = BRAND_QUICK_PICKS.filter((pick) => pick.hue !== 'blue');

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

/** The questions a link can't fill: a file and a signature are uploads, a ranking is an order (spec 0063). */
const NOT_PREFILLED: readonly string[] = ['file', 'signature', 'ranking'];

/** The questions a prefill link can fill, in the form's order. */
export function prefillable(questions: readonly FormQuestion[]): readonly FormQuestion[] {
  return questions.filter((question) => !NOT_PREFILLED.includes(question.answerType));
}

/**
 * A link that fills the form's first question (spec 0063, AC-6309): `?key=value`, a hidden question first when the
 * form has one, since setting one is what a prefill link is mostly for.
 */
export function prefillExample(link: string, questions: readonly FormQuestion[]): string {
  const first = questions.find((question) => question.answerType === 'hidden') ?? questions[0];
  if (first === undefined) return link;
  const value =
    first.answerType === 'email' ? 'ada@example.com' : first.answerType === 'hidden' ? 'spring-campaign' : 'Ada';
  return `${link}?${encodeURIComponent(first.key)}=${encodeURIComponent(value)}`;
}

/** Share, Put it on your site (the embed tiles and the snippet), then For developers, closed: own HTML, sites, secret. */
export function ShareTab({ slug, form, isReadOnly, onFormChange }: ShareTabProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const link = data.forms.hostedUrl(form.publicKey);
  const script = data.forms.embedUrl();
  const shown = form.live ?? form.draft;
  const [mode, setMode] = useState<EmbedMode>('inline');
  // What the snippet carries beyond the form (b6, S7): the button's words and the corner's colour, and an inline
  // form's clear ground and headline. Nothing here is saved: the snippet is what leaves, and the site keeps it.
  const [words, setWords] = useState<string>(strings.embedButtonText);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [isTransparent, setTransparent] = useState(false);
  const [isTitleHidden, setTitleHidden] = useState(false);
  const [isDeveloperOpen, setDeveloperOpen] = useState(false);
  const buttonWords = words.trim() === '' ? strings.embedButtonText : words.trim();
  const embed = embedSnippet(
    script,
    {
      kind: 'form',
      publicKey: form.publicKey,
      title: shown.headline,
      theme: shown.look.colour,
      // A button on a site's page reads as an invitation, not as the form's own Submit.
      buttonText: buttonWords,
      ...(accent === undefined ? {} : { accent }),
      isTransparent,
      isTitleHidden,
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
      {/* Row 1 (T44, S4): the link, the same block as the live dialog: the link with Copy link, the ways to send it
          under it, and its QR code beside them with its download. */}
      <Card title={strings.linkTitle}>
        <ShareBlock name={form.name} link={link} />
      </Card>
      {/* Row 2 (b6): how it shows on a site, the made up site beside the choices showing the pick, and the snippet
          they write. One way to copy: the code block's own Copy. */}
      <Card title={strings.websiteTitle} actions={<InfoTip label={strings.websiteTitle}>{strings.websiteTip}</InfoTip>}>
        {/* The three ways stacked as a column, their settings right under them, the made up site beside the
            column showing the pick (the owner, 5 November 2026: three wide tiles across the top left dead space
            under the switches). On a phone the site goes under the column. */}
        <TileGrid columns="two">
          <SettingsStack variant="flush">
            <TileGrid
              variant="choice"
              label={strings.embedMode}
              showsDescription
              tileWidth="full"
              tiles={EMBED_TILES}
              value={mode}
              onChange={(id) => {
                const tile = EMBED_TILES.find((each) => each.id === id);
                if (tile !== undefined) setMode(tile.id);
              }}
            />
            {mode === 'inline' ? (
              <>
                <Switch
                  label={strings.embedTransparent}
                  description={strings.embedTransparentHint}
                  isSelected={isTransparent}
                  onChange={setTransparent}
                />
                <Switch
                  label={strings.embedHideTitle}
                  description={strings.embedHideTitleHint}
                  isSelected={isTitleHidden}
                  onChange={setTitleHidden}
                />
              </>
            ) : (
              <Field label={strings.embedWords} value={words} maxLength={40} onChange={setWords} />
            )}
            {mode === 'floating' && (
              <AccentPicker
                label={strings.embedColour}
                defaultName={strings.embedColourDefault}
                quickPicks={EMBED_PICKS}
                hexPlacement="inline"
                value={accent}
                onChange={setAccent}
              />
            )}
          </SettingsStack>
          <EmbedPreview
            mode={mode}
            headline={shown.headline}
            words={buttonWords}
            {...(accent === undefined ? {} : { colour: accent })}
            isTransparent={isTransparent}
            isTitleHidden={isTitleHidden}
            label={strings.embedPreview}
          />
        </TileGrid>
        <Field label={strings.embedSnippet} variant="copy" isMultiline copyLabel={strings.copyEmbed} value={embed} />
      </Card>
      {/* The developer material in one sheet (b10), opened from a card of its own like the rows above it: the prefill link, the site's own HTML, the sites that may
          post and signed posts, out of the way of everyone who only pastes the snippet. */}
      <Card
        title={strings.advancedTitle}
        description={strings.advancedHint}
        actions={
          <Button
            icon="code"
            label={strings.advancedOpenName}
            onPress={() => {
              setDeveloperOpen(true);
            }}
          >
            {strings.advancedOpen}
          </Button>
        }
      />
      <Modal title={strings.advancedTitle} variant="sheet" isOpen={isDeveloperOpen} onOpenChange={setDeveloperOpen}>
        <SettingsStack variant="plain">
          {/* Prefill (spec 0063, AC-6309): a link that fills a question, and every question's key to fill. */}
          {shown.questions.length > 0 && (
            <Card
              title={strings.prefillTitle}
              actions={<InfoTip label={strings.prefillTitle}>{strings.prefillTip}</InfoTip>}
            >
              <Field
                label={strings.prefillExample}
                variant="copy"
                copyLabel={strings.copyPrefill}
                value={prefillExample(link, prefillable(shown.questions))}
              />
              <Table
                label={strings.prefillKeys}
                columns={[
                  { id: 'question', label: strings.prefillQuestion, isRowHeader: true },
                  { id: 'key', label: strings.prefillKey },
                ]}
                rows={prefillable(shown.questions)}
                getRowId={(question) => question.id}
                renderCell={(question, column) =>
                  column === 'question' ? (
                    question.label.trim() === '' ? (
                      question.key
                    ) : (
                      question.label
                    )
                  ) : (
                    <Code>{question.key}</Code>
                  )
                }
              />
            </Card>
          )}
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
        </SettingsStack>
      </Modal>
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
