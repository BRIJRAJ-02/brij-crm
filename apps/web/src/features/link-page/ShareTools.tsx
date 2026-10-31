// Brief
// Purpose: two of the overview's sharing tools (spec 0061, AC-6124, AC-6125): the page's address ready for each
// place it is shared, marked so Insights can tell the places apart, and the share QR in the owner's own style.
// Main task: copy the link for Instagram (or wherever), or style the code and download it as PNG or SVG.
// Leaves out: tracking of any person (a mark names a place, never a visitor) and an inverted code (the ground is
// always white, because not every scanner reads one).
import type { LinkPageStore, ProfileQrStyle } from '@crm/data';
import { useLinkPageQrStyle } from '@crm/data/react';
import {
  AccentPicker,
  Button,
  Callout,
  ChoiceChips,
  Field,
  FieldGroup,
  Modal,
  QrCode,
  Separator,
  type AccentQuickPick,
} from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { heldPicture, PictureField, type HeldPicture } from './block-extras.tsx';
import { qrPng, qrSvg, saveFile } from './qr-png.ts';
import { reachStrings as words } from './reach-strings.ts';

/** The places a ready link is offered for (AC-6125): each one's `utm_source` and `utm_medium`. */
const PLACES = [
  { id: 'instagram', label: words.placeInstagram, medium: 'social' },
  { id: 'tiktok', label: words.placeTiktok, medium: 'social' },
  { id: 'linkedin', label: words.placeLinkedin, medium: 'social' },
  { id: 'x', label: words.placeX, medium: 'social' },
  { id: 'email_signature', label: words.placeEmail, medium: 'email' },
  { id: 'qr', label: words.placeQr, medium: 'print' },
] as const;

/** A mark's word as Insights keeps it (AC-6116): letters, digits, `_`, `-` and `.`, up to 60. */
const MARK = /^[a-z0-9_.-]{1,60}$/;

/** The page's address with the marks Insights reads, the empty ones left off. */
export function markedAddress(
  address: string,
  marks: { readonly source: string; readonly medium?: string; readonly campaign?: string },
): string {
  const url = new URL(address);
  url.searchParams.set('utm_source', marks.source);
  if (marks.medium !== undefined && marks.medium !== '') url.searchParams.set('utm_medium', marks.medium);
  if (marks.campaign !== undefined && marks.campaign !== '') url.searchParams.set('utm_campaign', marks.campaign);
  return url.toString();
}

/** A typed mark, as Insights will keep it: lower case and trimmed, or its problem. */
function markOf(typed: string): { readonly value: string; readonly problem?: string } {
  const value = typed.trim().toLowerCase();
  if (value === '') return { value };
  return MARK.test(value) ? { value } : { value, problem: words.builderInvalid };
}

/** Props for ShareLinksModal. */
export interface ShareLinksModalProps {
  /** The page's whole address, scheme and all. */
  readonly address: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Links for each place (AC-6125): the address once per place, each a field that copies, and Your own, three words
 * that make a link for anywhere else. What each carries shows under Sources in Insights.
 */
export function ShareLinksModal({ address, isOpen, onClose }: ShareLinksModalProps) {
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('');
  const [campaign, setCampaign] = useState('');
  const typed = { source: markOf(source), medium: markOf(medium), campaign: markOf(campaign) };
  const isReady =
    typed.source.value !== '' &&
    typed.source.problem === undefined &&
    typed.medium.problem === undefined &&
    typed.campaign.problem === undefined;
  const shown = (link: string) => link.replace(/^https?:\/\//, '');
  return (
    <Modal
      title={words.shareLinks}
      hint={words.shareLinksText}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      actions={
        <Button variant="primary" slot="close">
          {words.done}
        </Button>
      }
    >
      {PLACES.map((place) => (
        <Field
          key={place.id}
          label={place.label}
          variant="copy"
          icon="link"
          value={shown(markedAddress(address, { source: place.id, medium: place.medium }))}
          copyLabel={words.copyLink}
        />
      ))}
      <Separator />
      <FieldGroup tone="heading" headingLevel={3} label={words.builder} hint={words.builderHint}>
        <Field
          label={words.builderSource}
          isRequired
          autoComplete="off"
          isVerbatim
          maxLength={60}
          placeholder={words.builderSourcePlaceholder}
          value={source}
          onChange={setSource}
          {...(typed.source.problem === undefined ? {} : { error: typed.source.problem })}
        />
        <Field
          label={words.builderMedium}
          autoComplete="off"
          isVerbatim
          maxLength={60}
          placeholder={words.builderMediumPlaceholder}
          value={medium}
          onChange={setMedium}
          {...(typed.medium.problem === undefined ? {} : { error: typed.medium.problem })}
        />
        <Field
          label={words.builderCampaign}
          autoComplete="off"
          isVerbatim
          maxLength={60}
          placeholder={words.builderCampaignPlaceholder}
          value={campaign}
          onChange={setCampaign}
          {...(typed.campaign.problem === undefined ? {} : { error: typed.campaign.problem })}
        />
        {isReady && (
          <Field
            label={words.builderLink}
            variant="copy"
            icon="link"
            value={shown(
              markedAddress(address, {
                source: typed.source.value,
                medium: typed.medium.value,
                campaign: typed.campaign.value,
              }),
            )}
            copyLabel={words.copyLink}
          />
        )}
      </FieldGroup>
    </Modal>
  );
}

/** The share QR's style as the code draws it: its colour, the centre picture's address and the frame's label. */
export interface DrawnQrStyle {
  readonly colour?: string;
  readonly picture?: string;
  readonly frameLabel?: string;
}

/**
 * The saved style as the code draws it (AC-6124): the person's own picture from Profile, an uploaded one from our
 * origin. Undefined keys draw the plain black code.
 */
export function drawnQrStyle(
  style: ProfileQrStyle | undefined,
  linkPage: LinkPageStore,
  slug: string,
  personImage: string | undefined,
): DrawnQrStyle {
  if (style === undefined) return {};
  const picture =
    style.picture?.from === 'person'
      ? personImage
      : style.picture?.from === 'upload'
        ? linkPage.reach.pictureSrc(slug, style.picture.image)
        : undefined;
  return {
    ...(style.colour === undefined ? {} : { colour: style.colour }),
    ...(picture === undefined ? {} : { picture }),
    ...(style.label === undefined ? {} : { frameLabel: style.label }),
  };
}

/** The share QR's saved style, read while the overview shows. */
export function useQrStyle(linkPage: LinkPageStore, slug: string): ProfileQrStyle | undefined {
  const state = useLinkPageQrStyle(linkPage.reach.qrStyle(slug));
  return state.status === 'ready' ? state.style : undefined;
}

/** Props for QrStyleModal. */
export interface QrStyleModalProps {
  readonly linkPage: LinkPageStore;
  readonly slug: string;
  readonly handle: string;
  /** What the code carries: the page's address. */
  readonly address: string;
  /** The person's own picture, when it shows on their pages. */
  readonly personImage?: string;
  /** The quick colour picks, the brand kit's nine. */
  readonly quickPicks: readonly AccentQuickPick[];
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/**
 * Style your QR code (AC-6124): a colour (refused with a hint when it is too light to scan), a picture in the
 * middle (theirs, or one uploaded) and a frame with a label, drawn as they are picked; Save keeps them for the
 * page, and the code downloads as a 1024 pixel PNG or as SVG.
 */
export function QrStyleModal({
  linkPage,
  slug,
  handle,
  address,
  personImage,
  quickPicks,
  isOpen,
  onClose,
}: QrStyleModalProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const saved = useQrStyle(linkPage, slug);
  const { rules } = linkPage.reach;
  const [colour, setColour] = useState<string | undefined>(saved?.colour);
  const [pictureFrom, setPictureFrom] = useState<'none' | 'person' | 'upload'>(saved?.picture?.from ?? 'none');
  const [upload, setUpload] = useState<HeldPicture | undefined>(() =>
    saved?.picture?.from === 'upload' ? heldPicture(linkPage, slug, saved.picture.image) : undefined,
  );
  const [hasFrame, setHasFrame] = useState(saved?.label !== undefined);
  const [label, setLabel] = useState(saved?.label ?? words.qrLabelPlaceholder);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [isSaving, setSaving] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const codeRef = useRef<SVGSVGElement>(null);
  const colourProblem = colour === undefined ? undefined : rules.qrColourProblem(colour);
  const labelProblem = hasFrame ? rules.qrLabelProblem(label) : undefined;
  const style: ProfileQrStyle = {
    ...(colour === undefined || colourProblem !== undefined ? {} : { colour }),
    ...(pictureFrom === 'person'
      ? { picture: { from: 'person' as const } }
      : pictureFrom === 'upload' && upload !== undefined
        ? { picture: { from: 'upload' as const, image: upload.image } }
        : {}),
    ...(hasFrame && labelProblem === undefined ? { label: label.trim() } : {}),
  };
  const drawn = drawnQrStyle(style, linkPage, slug, personImage);
  const save = () => {
    if (colourProblem !== undefined || labelProblem !== undefined || isSaving) return;
    setSaving(true);
    setRefusal(undefined);
    const isPlain = Object.keys(style).length === 0;
    void linkPage.reach
      .saveQrStyle(slug, isPlain ? null : style)
      .then((refused) => {
        if (refused === undefined) {
          toasts.toast({ tone: 'success', message: words.qrSaved });
          onClose();
        } else setRefusal(refused.message);
      })
      .finally(() => setSaving(false));
  };
  const download = (kind: 'png' | 'svg') => {
    const svg = codeRef.current;
    if (svg === null || isDownloading) return;
    setDownloading(true);
    (kind === 'png' ? qrPng(svg) : qrSvg(svg))
      .then((file) => saveFile(file, `${handle}-link-page.${kind}`))
      .catch(() => toasts.toast({ tone: 'danger', message: words.pictureFailed }))
      .finally(() => setDownloading(false));
  };
  return (
    <Modal
      title={words.qrStyleTitle}
      hint={words.qrBackground}
      isOpen={isOpen}
      isBusy={isSaving}
      isDismissable={false}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
      actions={
        <>
          <Button slot="close">{words.cancel}</Button>
          <Button
            variant="primary"
            isPending={isSaving}
            isDisabled={colourProblem !== undefined || labelProblem !== undefined}
            onPress={save}
          >
            {words.qrSave}
          </Button>
        </>
      }
    >
      <QrCode ref={codeRef} value={address} label={words.qrPreview} size="sm" {...drawn}>
        <Button icon="download" isPending={isDownloading} onPress={() => download('png')}>
          {words.qrPng}
        </Button>
        <Button icon="download" isDisabled={isDownloading} onPress={() => download('svg')}>
          {words.qrSvg}
        </Button>
      </QrCode>
      <AccentPicker
        label={words.qrColour}
        {...(colour === undefined ? {} : { value: colour })}
        onChange={(next) => {
          setColour(next);
          setRefusal(undefined);
        }}
        defaultName={words.qrColourDefault}
        defaultValue="#000000"
        quickPicks={quickPicks}
      >
        {(colourProblem ?? refusal) !== undefined && <Callout tone="danger">{colourProblem ?? refusal}</Callout>}
      </AccentPicker>
      <ChoiceChips
        isSingle
        label={words.qrPicture}
        choices={[
          { id: 'none', label: words.qrPictureNone },
          ...(personImage === undefined ? [] : [{ id: 'person', label: words.qrPicturePerson }]),
          { id: 'upload', label: words.qrPictureUpload },
        ]}
        selected={[pictureFrom]}
        onChange={(picked) => {
          const next = picked[0];
          if (next === 'none' || next === 'person' || next === 'upload') setPictureFrom(next);
        }}
      />
      {pictureFrom === 'upload' && (
        <PictureField
          label={upload === undefined ? words.imagePick : words.imageReplace}
          linkPage={linkPage}
          slug={slug}
          {...(upload === undefined ? {} : { value: upload })}
          onChange={(next) => {
            if (next !== undefined) setUpload(next);
          }}
        />
      )}
      <ChoiceChips
        isSingle
        label={words.qrFrame}
        choices={[
          { id: 'none', label: words.qrFrameNone },
          { id: 'label', label: words.qrFrameLabel },
        ]}
        selected={[hasFrame ? 'label' : 'none']}
        onChange={(picked) => setHasFrame(picked[0] === 'label')}
      />
      {hasFrame && (
        <Field
          label={words.qrLabel}
          autoComplete="off"
          maxLength={20}
          showCounter
          value={label}
          onChange={setLabel}
          {...(labelProblem === undefined ? {} : { error: labelProblem })}
        />
      )}
    </Modal>
  );
}
