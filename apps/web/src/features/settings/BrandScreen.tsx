// Brief
// Purpose: Settings › Workspace › Brand (spec 0060, AC-1 to AC-3, AC-6): the logo and colour every booking page and
// form of the workspace wears, beside a preview of both wearing it.
// Main task: an owner or admin adds the logo and picks the colour, and sees a booking page and a form change at once.
// Leaves out: a link page's own look (its Design panel), fonts and backgrounds (link pages only), and emails (later).
import type { BrandStore, PublicForm } from '@crm/data';
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
  Modal,
  MonthTiles,
  PreviewLayout,
  SegmentedControl,
  SettingsRow,
  Skeleton,
  SlotList,
  type PageBrand,
  type Toasts,
} from '@crm/ui';
import { useMemo, useState } from 'react';
import { BRAND_PHOTO_PICK_MAX_BYTES, BRAND_PHOTO_TYPES, preparePhoto } from '../link-page/photo-prep.ts';
import { strings } from './brand-strings.ts';
import { SettingsPage } from './SettingsPage.tsx';

/** Props for the Brand page. */
export interface BrandScreenProps {
  /** The brand store (`data.brand.load()`, loaded by the route). */
  readonly brand: BrandStore;
  readonly slug: string;
  readonly toasts: Toasts;
}

/** The sample times on the preview's booking page: a working morning. */
const SAMPLE_TIMES = ['09:00', '09:30', '10:00', '10:30'] as const;

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
  const sendLogo = (file: File) => {
    setRefusal(undefined);
    setSending(true);
    void preparePhoto(file, 'logo')
      .then(
        (image) => brand.uploadLogo(slug, image),
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
  };
  const preview =
    shown === 'booking' ? (
      // A sketch of a booking page, inert: the kit's logo heads its rail and its colour marks the chosen day and time.
      <div inert>
        <BookingFrame
          isCompact
          brand={wearing}
          host={{ name: strings.sampleHost }}
          title={strings.sampleMeeting}
          facts={[{ id: 'length', icon: 'clock', children: strings.sampleLength }]}
          heading={strings.sampleChooseTime}
          aside={
            <SlotList
              heading={strings.sampleChooseTime}
              slots={SAMPLE_TIMES.map((time) => ({ id: time, label: time, name: time }))}
              value={SAMPLE_TIMES[1]}
              onChange={() => undefined}
            />
          }
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
    <SettingsPage title={strings.title} fillsView>
      <PreviewLayout
        bodyWidth="form"
        previewShare="wide"
        {...(kit !== undefined && !canEdit ? { notices: <Callout tone="info">{strings.readOnly}</Callout> } : {})}
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
            <EmptyState title={strings.failed} icon="palette">
              <Button onPress={() => brand.kit(slug).retry()}>{strings.retry}</Button>
            </EmptyState>
          </Card>
        ) : (
          <Card
            title={strings.kit}
            isBusy={kit === undefined}
            {...(refusal === undefined ? {} : { footerNote: refusal })}
          >
            <SettingsRow title={strings.logo} description={strings.logoText} control="field">
              {kit === undefined ? (
                <Skeleton shape="field" />
              ) : canEdit ? (
                <FileDrop
                  label={kit.logo === undefined ? strings.logoDrop : strings.logoReplace}
                  acceptedTypes={BRAND_PHOTO_TYPES}
                  maxSize={BRAND_PHOTO_PICK_MAX_BYTES}
                  isDisabled={isSending}
                  {...(logoSrc === undefined ? {} : { preview: { src: logoSrc, alt: strings.logoAlt } })}
                  onFiles={(files) => {
                    const [file] = files;
                    if (file !== undefined) sendLogo(file);
                  }}
                />
              ) : (
                logoSrc !== undefined && (
                  <FileDrop
                    label={strings.logo}
                    variant="button"
                    isDisabled
                    preview={{ src: logoSrc, alt: strings.logoAlt }}
                    onFiles={() => undefined}
                  />
                )
              )}
            </SettingsRow>
            {canEdit && kit.logo !== undefined && (
              <Button variant="ghost" size="md" icon="trash" onPress={() => setRemoving(true)}>
                {strings.logoRemove}
              </Button>
            )}
            <SettingsRow title={strings.colour} description={strings.colourText} control="field">
              {kit === undefined ? (
                <Skeleton shape="field" />
              ) : (
                <AccentPicker
                  label={strings.colour}
                  isLabelHidden
                  defaultName={strings.colourDefault}
                  {...(kit.accent === undefined ? {} : { value: kit.accent })}
                  quickPicks={brand.quickPicks}
                  isReadOnly={!canEdit}
                  {...(colours?.adjusted === true ? { drawn: { light: colours.light, dark: colours.dark } } : {})}
                  onPreview={setDragged}
                  onChange={(next) => {
                    save(next, next === undefined ? undefined : kit.accentDark);
                  }}
                />
              )}
            </SettingsRow>
            {/* A separate colour for dark pages (AC-6), once there is a colour to set it beside. */}
            {kit?.accent !== undefined && (
              <Disclosure title={strings.colourMore} variant="quiet">
                <AccentPicker
                  label={strings.colourMore}
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
          </Card>
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
