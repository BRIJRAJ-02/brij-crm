// Brief
// Purpose: Settings › Workspace › Brand (spec 0060, AC-1 to AC-3, AC-6; spec 0068, AC-6804): the template, logo and
// colour every public page of the workspace wears, beside a preview of a booking page and a form wearing them.
// Main task: an owner or admin picks the template, adds the logo and picks the colour, and sees the pages change.
// Leaves out: a link page's own look (its Design panel), fonts and backgrounds (link pages only), and emails (later).
import { DEFAULT_PAGE_THEME, themeForTemplate, type BrandStore, type PageTemplate, type PublicForm } from '@crm/data';
import { useBrand } from '@crm/data/react';
import {
  AccentPicker,
  BookingFrame,
  Button,
  Callout,
  Card,
  Disclosure,
  EmptyState,
  FileDrop,
  HostedFormPreview,
  LinkPageThumbnail,
  Modal,
  MonthTiles,
  PreviewLayout,
  PublishBar,
  SegmentedControl,
  SettingsSection,
  Skeleton,
  TileGrid,
  usePhotoCrop,
  type PageBrand,
  type Toasts,
} from '@crm/ui';
import { preparePhoto } from '@crm/ui/photo';
import { useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { BRAND_LOGO_PICK_MAX_BYTES, BRAND_PHOTO_TYPES } from '../link-page/photo-prep.ts';
import { strings as pageStrings } from '../link-page/strings.ts';
import { strings } from './brand-strings.ts';

/** Each template's one line, as the link page's picker says it (spec 0068, AC-6804). */
const TEMPLATE_TEXT: Readonly<Record<PageTemplate, string>> = {
  classic: pageStrings.templateClassicText,
  studio: pageStrings.templateStudioText,
  night: pageStrings.templateNightText,
  split: pageStrings.templateSplitText,
};
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the Brand page. */
export interface BrandScreenProps {
  /** The brand store (`data.brand.load()`, loaded by the route). */
  readonly brand: BrandStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

/** The sample form the preview draws: two questions and a button, enough to show the colour on each. */
const SAMPLE_FORM: PublicForm = {
  key: 'brand-preview',
  status: 'live',
  versionNumber: 1,
  headline: strings.sampleHeadline,
  buttonText: strings.sampleSend,
  language: 'en',
  look: { colour: 'light', corners: 'rounded' },
  questions: [
    { id: 'name', key: 'name', label: strings.sampleName, answerType: 'short_text', required: true },
    { id: 'email', key: 'email', label: strings.sampleEmail, answerType: 'email', required: true },
  ],
  offersMeeting: false,
};

/** `YYYY-MM-DD` for a date, in its own zone. */
function dayOf(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The four templates (spec 0068), in the picker's order. */
const TEMPLATES: readonly { readonly id: PageTemplate; readonly name: string }[] = [
  { id: 'classic', name: strings.templateClassic },
  { id: 'studio', name: strings.templateStudio },
  { id: 'night', name: strings.templateNight },
  { id: 'split', name: strings.templateSplit },
];

/**
 * A template's look as its own thumbnail wears it: a template that follows the visitor's light or dark (Classic,
 * Split) is drawn light, as a first visitor most often meets it; Night stays dark and Studio light.
 */
const ownLook = (template: PageTemplate) => themeForTemplate(template, DEFAULT_PAGE_THEME);

/** A template's name, as the picker says it. */
const nameOf = (template: PageTemplate): string => TEMPLATES.find((one) => one.id === template)?.name ?? template;

/** Which page the preview shows. */
type PreviewPage = 'booking' | 'form';

/** Settings › Brand: the kit beside a preview of a booking page or a form wearing it. */
export function BrandScreen({ brand, slug, toasts }: BrandScreenProps) {
  const state = useBrand(brand.kit(slug));
  const [shown, setShown] = useState<PreviewPage>('booking');
  const [dragged, setDragged] = useState<string | undefined>(undefined);
  const [isRemoving, setRemoving] = useState(false);
  const [isSending, setSending] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const kit = state.status === 'ready' ? state.value : undefined;
  const canEdit = kit?.canEdit === true;
  const accent = dragged ?? kit?.accent;
  const colours = brand.colours(accent, kit?.accentDark);
  const logoSrc = kit?.logo === undefined ? undefined : brand.logoSrc(slug, kit.logo.version);
  // The kit as both previews wear it: the same variables the pages' brand stylesheet sets, from the same function.
  const wearing: PageBrand = {
    ...(logoSrc === undefined ? {} : { logo: { src: logoSrc, alt: strings.logoAlt } }),
    ...(colours === undefined ? {} : { variables: colours.variables }),
    // The template as picked (spec 0068): a pick waiting for Publish shows here before any public page wears it.
    ...(kit === undefined ? {} : { template: kit.templateDraft ?? kit.template }),
  };
  const chosen = kit === undefined ? undefined : (kit.templateDraft ?? kit.template);
  // The preview crossfades to the new template: the browser's own view transition, an opacity fade of the old
  // picture into the new (none under reduced motion, or where the browser has none).
  const crossfade = (change: () => void) => {
    const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof document.startViewTransition !== 'function') change();
    else document.startViewTransition(() => flushSync(change));
  };
  const chooseTemplate = (template: PageTemplate) => {
    setRefusal(undefined);
    crossfade(() => {
      void brand.saveTemplate(slug, template).then((refused) => {
        if (refused !== undefined) setRefusal(refused.message);
      });
    });
  };
  const publishTemplate = () => {
    setRefusal(undefined);
    void brand.publishTemplate(slug).then((refused) => {
      if (refused !== undefined) setRefusal(refused.message);
    });
  };
  const discardTemplate = () => {
    setRefusal(undefined);
    crossfade(() => {
      void brand.discardTemplate(slug).then((refused) => {
        if (refused !== undefined) setRefusal(refused.message);
      });
    });
  };
  const month = useMemo(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const open = new Set<string>();
    for (let date = new Date(first); date.getMonth() === first.getMonth(); date.setDate(date.getDate() + 1)) {
      if (date.getDay() !== 0 && date.getDay() !== 6 && date >= now) open.add(dayOf(date));
    }
    return { month: dayOf(first).slice(0, 7), today: dayOf(now), open, chosen: [...open][0] };
  }, []);
  const save = (next: string | undefined, nextDark: string | undefined) => {
    setDragged(undefined);
    setRefusal(undefined);
    void brand.saveKit(slug, next, nextDark).then((refused) => {
      if (refused !== undefined) setRefusal(refused.message);
    });
  };
  // The logo picked, or the one there, through the cropper (spec 0068, AC-6809). Its frame is free and opens on the
  // logo's own shape, so a wide wordmark keeps every letter (the tab's icon draws it whole on a plate, favicon.ts);
  // Square is one press away for a mark.
  const cropping = usePhotoCrop();
  const sendLogo = (source: File | string) => {
    setRefusal(undefined);
    void cropping.crop(source, 'free').then((crop) => {
      if (crop === undefined) return;
      setSending(true);
      void preparePhoto(source, 'logo', crop)
        .then(
          (image) => brand.uploadLogo(slug, image.blob),
          () => {
            toasts.toast({ tone: 'danger', message: strings.logoUnreadable });
            return undefined;
          },
        )
        .then((refused) => {
          if (refused !== undefined) setRefusal(refused.message);
        })
        .finally(() => {
          setSending(false);
        });
    });
  };
  const preview =
    shown === 'booking' ? (
      // A sketch of a booking page, inert: the kit's logo heads its rail and its colour marks the chosen day. The day's
      // times are left out, as a phone shows them once a day is picked, so the whole page and its foot fit the phone.
      // A new template crossfades in through the page's view transition (`crossfade` above).
      <div inert>
        <BookingFrame
          isCompact
          brand={wearing}
          host={{ name: strings.sampleHost }}
          title={strings.sampleMeeting}
          facts={[{ id: 'length', icon: 'clock', children: strings.sampleLength }]}
          heading={strings.sampleChooseTime}
        >
          <MonthTiles
            month={month.month}
            today={month.today}
            openDays={month.open}
            value={month.chosen}
            onChange={() => undefined}
            onMonthChange={() => undefined}
            canPrevious={false}
            canNext={false}
          />
        </BookingFrame>
      </div>
    ) : (
      <HostedFormPreview form={SAMPLE_FORM} brand={wearing} />
    );
  return (
    <SettingsPage
      title={strings.title}
      fillsView
      {...(kit !== undefined && !canEdit ? { viewOnly: strings.readOnly } : {})}
    >
      <PreviewLayout
        bodyWidth="form"
        previewShare="wide"
        // Every notice that holds, together (a refused colour never hides a template waiting for Publish): a refusal
        // above the sections, where each can be seen from; then the Publish bar (owner, 4 Nov 2026: every public page
        // changes at once when it goes, so it heads the page, where the editors' bars sit). A reader's View only tag
        // is the page's own (`viewOnly`), never a note here.
        {...(refusal === undefined && (kit?.templateDraft === undefined || !canEdit)
          ? {}
          : {
              notices: (
                <>
                  {refusal !== undefined && <Callout tone="danger">{refusal}</Callout>}
                  {canEdit && kit.templateDraft !== undefined && (
                    <PublishBar
                      status="draft"
                      changes={[strings.templateChange(nameOf(kit.template), nameOf(kit.templateDraft))]}
                      onPublish={publishTemplate}
                      onDiscard={discardTemplate}
                    />
                  )}
                </>
              ),
            })}
        preview={preview}
        previewControls={
          <SegmentedControl
            label={strings.preview}
            segments={[
              { value: 'booking', label: strings.previewBooking },
              { value: 'form', label: strings.previewForm },
            ]}
            value={shown}
            onChange={(next) => setShown(next === 'form' ? 'form' : 'booking')}
          />
        }
      >
        {state.status === 'error' ? (
          <Card>
            <EmptyState tone="error" title={strings.failed} onRetry={() => brand.kit(slug).retry()} />
          </Card>
        ) : (
          <>
            {/* Logo, Colour, then Template (critics A #11 and B #6, 5 November 2026): what the brand is first, then the
                look every page wears, each its own section, as Linear's and Vercel's settings read. */}
            <SettingsSection title={strings.logo}>
              <Card isBusy={kit === undefined}>
                {kit === undefined ? (
                  <Skeleton shape="field" />
                ) : canEdit ? (
                  <>
                    <FileDrop
                      label={kit.logo === undefined ? strings.logoDrop : strings.logoReplace}
                      acceptedTypes={BRAND_PHOTO_TYPES}
                      typesText={strings.logoTypes}
                      maxSize={BRAND_LOGO_PICK_MAX_BYTES}
                      isDisabled={isSending}
                      {...(logoSrc === undefined
                        ? {}
                        : {
                            preview: { src: logoSrc, alt: strings.logoAlt },
                            onAdjust: () => {
                              sendLogo(logoSrc);
                            },
                          })}
                      onFiles={(files) => {
                        const [file] = files;
                        if (file !== undefined) sendLogo(file);
                      }}
                    />
                    {cropping.cropper}
                    {kit.logo !== undefined && (
                      <Button
                        variant="ghost"
                        icon="trash"
                        label={strings.logoRemove}
                        onPress={() => setRemoving(true)}
                      />
                    )}
                  </>
                ) : logoSrc === undefined ? (
                  strings.noLogo
                ) : (
                  <FileDrop
                    label={strings.logo}
                    isReadOnly
                    preview={{ src: logoSrc, alt: strings.logoAlt }}
                    onFiles={() => undefined}
                  />
                )}
              </Card>
            </SettingsSection>
            <SettingsSection title={strings.colour}>
              <Card isBusy={kit === undefined}>
                {kit === undefined ? (
                  <Skeleton shape="field" />
                ) : (
                  <AccentPicker
                    label={strings.colour}
                    isLabelHidden
                    // The hex ends the swatches' row, so it reads as the colour's own value, not a stray field.
                    hexPlacement="inline"
                    defaultName={strings.colourDefault}
                    {...(kit.accent === undefined ? {} : { value: kit.accent })}
                    quickPicks={brand.quickPicks}
                    isReadOnly={!canEdit}
                    {...(colours?.adjusted === true ? { drawn: { light: colours.light, dark: colours.dark } } : {})}
                    onPreview={setDragged}
                    onChange={(next) => {
                      save(next, next === undefined ? undefined : kit.accentDark);
                    }}
                  >
                    {/* A separate colour for dark pages (AC-6), once there is a colour to set it beside. */}
                    {kit.accent !== undefined && (
                      <Disclosure title={strings.colourMore} variant="quiet">
                        <AccentPicker
                          label={strings.colourMore}
                          hexPlacement="inline"
                          defaultName={strings.colourDarkDefault}
                          {...(kit.accentDark === undefined ? {} : { value: kit.accentDark })}
                          quickPicks={brand.quickPicks}
                          isReadOnly={!canEdit}
                          onChange={(nextDark) => {
                            save(kit.accent, nextDark);
                          }}
                        />
                      </Disclosure>
                    )}
                  </AccentPicker>
                )}
              </Card>
            </SettingsSection>
            {/* The template every public page wears (spec 0068, AC-6804): four finished looks picked by sight, across
                the section's whole width (four to a row where it holds them, two by two where it doesn't). */}
            <SettingsSection title={strings.template}>
              <Card isBusy={kit === undefined}>
                {kit === undefined ? (
                  <Skeleton shape="block" />
                ) : (
                  <TileGrid
                    variant="choice"
                    label={strings.template}
                    showsDescription
                    keepsPicture
                    pictureSize="large"
                    value={chosen ?? kit.template}
                    tiles={TEMPLATES.map((template) => ({
                      id: template.id,
                      name: template.name,
                      description: TEMPLATE_TEXT[template.id],
                      isDisabled: !canEdit,
                      // The template as a page in the kit's own colour and logo, in its own light or dark, never the
                      // app's (critic A #11: in the app's dark theme three of the four looked like Night).
                      thumbnail: (
                        <LinkPageThumbnail
                          theme={ownLook(template.id)}
                          // Classic and Split follow the visitor: drawn light, as most visitors see them.
                          mode="light"
                          size="large"
                          {...(colours === undefined ? {} : { variables: colours.variables })}
                          profile={{
                            name: strings.sampleHost,
                            ...(logoSrc === undefined ? {} : { logo: logoSrc }),
                            rows: [strings.sampleMeeting, strings.sampleHeadline],
                          }}
                        />
                      ),
                    }))}
                    onChange={(picked) => {
                      const found = TEMPLATES.find((template) => template.id === picked);
                      if (found !== undefined && found.id !== chosen) chooseTemplate(found.id);
                    }}
                  />
                )}
              </Card>
            </SettingsSection>
          </>
        )}
      </PreviewLayout>
      <Modal
        isOpen={isRemoving}
        onOpenChange={setRemoving}
        title={strings.logoRemoving}
        variant="confirm"
        tone="danger"
        actions={
          <>
            <Button variant="ghost" onPress={() => setRemoving(false)}>
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                setRemoving(false);
                setRefusal(undefined);
                void brand.removeLogo(slug).then((refused) => {
                  if (refused !== undefined) setRefusal(refused.message);
                });
              }}
            >
              {strings.logoRemove}
            </Button>
          </>
        }
      >
        {strings.logoRemoveText}
      </Modal>
    </SettingsPage>
  );
}
