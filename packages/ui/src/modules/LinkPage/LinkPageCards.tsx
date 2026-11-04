// Spec 0068's bento (AC-6808), its own chunk: loaded only for a page laid out as a grid, or one carrying one of the
// new cards (a profile card, a status, an audio intro, a timeline, logos, work, how I work, a location, events). The
// first load of the booking page and the link page holds none of it.
import { useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { SegmentedControl } from '../../molecules/SegmentedControl/SegmentedControl.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { safeImageSrc } from '../../lib/safe-image-src.ts';
import { useFormatSettings, useNow } from '../../provider/context.ts';
import { bentoSpans, spanOf } from './bento.ts';
import {
  ApartBlockView,
  LazyPictureBlock,
  LinkPageCardHold,
  LinkTile,
  PageActionsContext,
  PageTile,
  RowCard,
  isCardBlock,
  isRowBlock,
  type CardBlock,
  type LinkPageBlock,
  type LinkPagePicture,
} from './LinkPage.tsx';
import styles from './LinkPageCards.module.css';
import { strings } from './strings.ts';

/** Props for one card drawn on its own, in a list page's column. */
export interface LinkPageCardProps {
  readonly block: CardBlock;
  /** Under the person's name, or under a section's heading. */
  readonly level: 2 | 3;
  /** A visitor pressed something in it that counts (Play, Book, Directions, a work card, an event). */
  readonly onPress?: (id: string) => void;
}

/** Props for a group of blocks drawn as one bento grid. */
export interface LinkPageBentoProps {
  readonly rows: readonly LinkPageBlock[];
  readonly level: 2 | 3;
  /** The list's name, when no heading names the group. */
  readonly label?: string;
  readonly onPress?: (id: string) => void;
}

/** How many cards enter one after another before the rest arrive together: a short run reads, a long one waits. */
const STAGGERED = 6;

/**
 * A group as a bento grid (AC-6808): one column on a phone, two where the blocks have the room, three where they
 * have more, each card one or two columns wide as its owner set it and snapped so every row is full (`bentoSpans`).
 * One list in the owner's order, so the screen, the reading order and the focus order agree.
 */
export function LinkPageBento({ rows, level, label, onPress }: LinkPageBentoProps) {
  const { isLive } = useContext(PageActionsContext);
  const cells = rows.filter((block) => block.kind !== 'heading' && block.kind !== 'banner');
  const wanted = cells.map((block) => spanOf('size' in block ? block.size : undefined));
  const two = bentoSpans(wanted, 2);
  const three = bentoSpans(wanted, 3);
  if (cells.length === 0) return null;
  return (
    <div className={styles.room}>
      <ul className={styles.grid} {...(label === undefined ? {} : { 'aria-label': label })}>
        {cells.map((block, at) => (
          <li
            key={block.id}
            className={styles.cell}
            data-kind={block.kind}
            data-span2={two[at]}
            data-span3={three[at]}
            data-enter={isLive ? Math.min(at + 1, STAGGERED) : undefined}
          >
            <BentoCell block={block} level={level} onPress={onPress} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One cell's card, by kind: the row and tile cards the page already draws, framed words, or one of the new cards. */
function BentoCell({
  block,
  level,
  onPress,
}: {
  readonly block: LinkPageBlock;
  readonly level: 2 | 3;
  readonly onPress: ((id: string) => void) | undefined;
}) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  if (isCardBlock(block))
    return <LinkPageCard block={block} level={level} {...(onPress === undefined ? {} : { onPress })} />;
  if (block.kind === 'link') return <LinkTile block={block} onPress={press} />;
  if (block.kind === 'page') return <PageTile block={block} onPress={press} />;
  if (isRowBlock(block)) return <RowCard block={block} onPress={onPress} />;
  if (block.kind === 'media' || block.kind === 'image' || block.kind === 'gallery') {
    return <LazyPictureBlock block={block} onPress={onPress} isTile />;
  }
  if (block.kind === 'times') return <ApartBlockView block={block} level={level} onPress={onPress} />;
  if (block.kind === 'heading' || block.kind === 'banner') return null;
  // Words, a quote, questions and the socials row have no card of their own on a list page: on a grid each sits in
  // the same card every other cell is.
  return (
    <Card kind={block.kind}>
      <ApartBlockView block={block} level={level} onPress={onPress} />
    </Card>
  );
}

/**
 * A card's frame (AC-6808): the template's card surface, radius, padding and soft shadow, the same on every card, and
 * a hover lift under a fine pointer. `isPressable` adds the press: the lift settles back while it is held.
 */
function Card({
  kind,
  children,
  labelledBy,
  isPressable = false,
}: {
  readonly kind: string;
  readonly children: ReactNode;
  readonly labelledBy?: string;
  readonly isPressable?: boolean;
}) {
  return (
    <article
      className={styles.card}
      data-card={kind}
      data-pressable={isPressable || undefined}
      {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}
    >
      {children}
    </article>
  );
}

/** A card's small title, as the reference cards carry theirs: a quiet chip with the card's mark. */
function CardTitle({
  id,
  level,
  icon,
  children,
}: {
  readonly id: string;
  readonly level: 2 | 3;
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly children: string;
}) {
  const Title = level === 2 ? 'h2' : 'h3';
  return (
    <Title id={id} className={styles.chip}>
      <Icon name={icon} size="sm" />
      {children}
    </Title>
  );
}

/** One of spec 0068's cards, in a list page's column or in a bento cell. */
export function LinkPageCard({ block, level, onPress }: LinkPageCardProps) {
  const press = onPress === undefined ? undefined : () => onPress(block.id);
  switch (block.kind) {
    case 'profile':
      return <ProfileCard block={block} onPress={press} />;
    case 'status':
      return <StatusCard block={block} />;
    case 'audio':
      return <AudioCard block={block} onPress={press} />;
    case 'timeline':
      return <TimelineCard block={block} level={level} />;
    case 'logos':
      return <LogosCard block={block} level={level} />;
    case 'work':
      return <WorkCard block={block} level={level} onPress={press} />;
    case 'steps':
      return <StepsCard block={block} level={level} />;
    case 'location':
      return <LocationCard block={block} level={level} onPress={press} />;
    case 'events':
      return <EventsCard block={block} level={level} onPress={press} />;
  }
}

/** The profile card: the page's own face and name, its one line, then Book and Share. */
function ProfileCard({
  block,
  onPress,
}: {
  readonly block: Extract<CardBlock, { kind: 'profile' }>;
  readonly onPress: (() => void) | undefined;
}) {
  const { person, share, book, avatar } = useContext(PageActionsContext);
  const nameId = useId();
  if (person === undefined) return <LinkPageCardHold />;
  const line = block.line ?? person.bio;
  const bookHref = book === undefined ? undefined : ownPath(book.href);
  return (
    <Card kind="profile" labelledBy={nameId}>
      <span className={styles.profileFace}>
        <Avatar
          name={person.name}
          id={person.id}
          size="hero"
          shape={avatar === 'rounded' ? 'square' : 'circle'}
          isDecorative
          {...(person.image === undefined ? {} : { src: person.image })}
        />
      </span>
      <span className={styles.profileWords}>
        <span id={nameId} className={styles.cardName}>
          {person.name}
        </span>
        {line !== undefined && line !== '' && <span className={styles.quiet}>{line}</span>}
      </span>
      {(bookHref !== undefined || share !== undefined) && (
        <span className={styles.actions}>
          {bookHref !== undefined && book !== undefined && (
            <ButtonLink
              variant="primary"
              size="touch"
              icon="calendar"
              href={bookHref}
              {...(onPress === undefined ? {} : { onPress })}
            >
              {book.label}
            </ButtonLink>
          )}
          {share}
        </span>
      )}
    </Card>
  );
}

/** "Available for work": the words beside a dot, green and softly breathing while open, quiet while away. */
function StatusCard({ block }: { readonly block: Extract<CardBlock, { kind: 'status' }> }) {
  return (
    <Card kind="status">
      <span className={styles.status}>
        <span className={styles.dot} data-state={block.state} aria-hidden="true" />
        <span className={styles.cardName}>{block.text}</span>
      </span>
    </Card>
  );
}

/** The heights a waveform's characters stand for: `0` the lowest to `v` the highest, 32 steps. */
const WAVE_DIGITS = '0123456789abcdefghijklmnopqrstuv';
/** A waveform with no stored bars: a calm, even shape, so the card never draws empty. */
const FLAT_WAVE = 'ggkkoossoookkggggkkoossoookkggggkkoossoookkgggggg';

/** Seconds as the player says them: `0:32`. */
function clockOf(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A short audio intro: one Play button, the waveform filling in as it plays, and the time left. Only its metadata
 * loads until Play, from our own origin; a recording that fails says so and keeps the card.
 */
function AudioCard({
  block,
  onPress,
}: {
  readonly block: Extract<CardBlock, { kind: 'audio' }>;
  readonly onPress: (() => void) | undefined;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [length, setLength] = useState<number | undefined>(undefined);
  // A recording that can't load says so only once a visitor asked for it: the card stays calm until then.
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(false);
  const src = safeImageSrc(block.src);
  const title = block.title ?? strings.introTitle;
  const wave = block.wave ?? FLAT_WAVE;
  const played = length === undefined || length === 0 ? 0 : elapsed / length;
  const toggle = () => {
    const audio = audioRef.current;
    if (audio === null) return;
    if (audio.paused) {
      setAsked(true);
      onPress?.();
      audio.play().catch(() => {
        setFailed(true);
      });
    } else {
      audio.pause();
    }
  };
  return (
    <Card kind="audio">
      <span className={styles.player}>
        <Button
          variant="primary"
          size="touch"
          icon={isPlaying ? 'pause' : 'play'}
          label={isPlaying ? strings.pauseIntro(title) : strings.playIntro(title)}
          isDisabled={src === undefined || (failed && asked)}
          onPress={toggle}
        />
        <span className={styles.wave} aria-hidden="true">
          {Array.from({ length: wave.length }, (_, at) => (
            <span
              // The bars never reorder: their place is their key.
              key={at}
              className={styles.bar}
              data-played={at / wave.length < played || undefined}
              style={{ '--bar': String(Math.max(1, WAVE_DIGITS.indexOf(wave.charAt(at)))) }}
            />
          ))}
        </span>
        <span className={styles.time} role="status">
          {failed && asked ? strings.introFailed : length === undefined ? '' : clockOf(length - elapsed)}
        </span>
      </span>
      {block.title !== undefined && <span className={styles.footTitle}>{block.title}</span>}
      {src !== undefined && (
        // A visitor's own control is the button above; the element itself is never shown. A spoken intro of a
        // minute has no captions file to offer; the card's title says what it is.
        // eslint-disable-next-line jsx-a11y-x/media-has-caption
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds)) setLength(seconds);
          }}
          onTimeUpdate={(event) => {
            setElapsed(event.currentTarget.currentTime);
          }}
          onPlay={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setElapsed(0);
          }}
          onError={() => {
            setFailed(true);
          }}
        />
      )}
    </Card>
  );
}

/** An experience timeline: a quiet rail with a dot per row, when above what and where. */
function TimelineCard({
  block,
  level,
}: {
  readonly block: Extract<CardBlock, { kind: 'timeline' }>;
  readonly level: 2 | 3;
}) {
  const titleId = useId();
  return (
    <Card kind="timeline" labelledBy={titleId}>
      <CardTitle id={titleId} level={level} icon="activity">
        {block.title ?? strings.experience}
      </CardTitle>
      <ol className={styles.rail}>
        {block.items.map((row) => (
          <li key={`${row.when}-${row.title}`} className={styles.railRow}>
            <span className={styles.railDot} aria-hidden="true" />
            <span className={styles.railWords}>
              <span className={styles.quiet}>{row.when}</span>
              <span className={styles.rowTitle}>{row.title}</span>
              {row.place !== undefined && <span className={styles.quiet}>{row.place}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * Client logos drifting sideways, as one row: the list once for screen readers and the keyboard, and drawn twice so
 * the drift loops with no seam (the copy hidden). It holds still under reduced motion, and while hovered or focused.
 */
function LogosCard({ block, level }: { readonly block: Extract<CardBlock, { kind: 'logos' }>; readonly level: 2 | 3 }) {
  const titleId = useId();
  // The drift stops for good when a visitor asks (WCAG 2.2.2): a keyboard or a finger can't hover to hold it.
  const [isPaused, setPaused] = useState(false);
  const logos = block.images.flatMap((image) => {
    const src = safeImageSrc(image.src);
    return src === undefined ? [] : [{ ...image, src }];
  });
  const logo = (image: LinkPagePicture & { readonly alt: string }, isCopy: boolean) => (
    <li key={`${isCopy ? 'copy-' : ''}${image.src}`} className={styles.logo}>
      <img
        className={styles.logoImage}
        src={image.src}
        width={image.width}
        height={image.height}
        alt={isCopy ? '' : image.alt}
        loading="lazy"
        decoding="async"
      />
    </li>
  );
  return (
    <Card kind="logos" labelledBy={titleId}>
      <CardTitle id={titleId} level={level} icon="building">
        {block.title ?? strings.clients}
      </CardTitle>
      <div className={styles.marquee} data-paused={isPaused || undefined}>
        <ul className={styles.track} data-drifts={logos.length > 2 || undefined}>
          {logos.map((image) => logo(image, false))}
        </ul>
        {logos.length > 2 && (
          <ul className={styles.track} data-drifts="" aria-hidden="true">
            {logos.map((image) => logo(image, true))}
          </ul>
        )}
      </div>
      {logos.length > 2 && (
        <span className={styles.marqueeControl}>
          <Button
            variant="ghost"
            size="sm"
            icon={isPaused ? 'play' : 'pause'}
            label={isPaused ? strings.playLogos : strings.pauseLogos}
            onPress={() => {
              setPaused((was) => !was);
            }}
          />
        </span>
      )}
    </Card>
  );
}

/** How long an event stays on the card after it starts: one that is running is still worth finding. */
const EVENT_RUNS_MS = 3 * 3_600_000;

/** A path on this site's own origin, or undefined. */
function ownPath(href: string | undefined): string | undefined {
  return href !== undefined && href.startsWith('/') && !/^\/[/\\]/.test(href) ? href : undefined;
}

/** A web address a card may open in a new tab, or undefined: the library's one href rule, web only. */
function webHref(href: string | undefined): string | undefined {
  const safe = href === undefined ? undefined : safeHref(href);
  return safe !== undefined && /^https?:/i.test(safe) ? safe : undefined;
}

/** Work cards: a picture, a title and two lines each; a card with a link is the link. */
function WorkCard({
  block,
  level,
  onPress,
}: {
  readonly block: Extract<CardBlock, { kind: 'work' }>;
  readonly level: 2 | 3;
  readonly onPress: (() => void) | undefined;
}) {
  const titleId = useId();
  return (
    <Card kind="work" labelledBy={titleId}>
      <CardTitle id={titleId} level={level} icon="briefcase">
        {block.title ?? strings.work}
      </CardTitle>
      <ul className={styles.pieces}>
        {block.items.map((item, index) => {
          const href = webHref(item.href);
          const src = item.image === undefined ? undefined : safeImageSrc(item.image.src);
          const body = (
            <>
              <span className={styles.pieceImage}>
                {src !== undefined && item.image !== undefined && (
                  <img
                    className={styles.pieceShot}
                    src={src}
                    width={item.image.width}
                    height={item.image.height}
                    alt={strings.thumbAlt}
                    loading="lazy"
                    decoding="async"
                  />
                )}
              </span>
              <span className={styles.pieceWords}>
                <span className={styles.rowTitle}>{item.title}</span>
                {item.body !== undefined && <span className={styles.twoLines}>{item.body}</span>}
              </span>
              {href !== undefined && (
                <span className={styles.pieceEnd}>
                  <Icon name="arrow-up-right" size="sm" />
                  <VisuallyHidden>{strings.opensElsewhere}</VisuallyHidden>
                </span>
              )}
            </>
          );
          return (
            <li key={`${String(index)}-${item.title}`} className={styles.pieceItem}>
              {href === undefined ? (
                <span className={styles.piece}>{body}</span>
              ) : (
                <a
                  className={styles.piece}
                  data-pressable=""
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={onPress}
                >
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * How I work: one step large at a time, its number and name over its words, and the steps' switcher under it (the
 * library's SegmentedControl, whose thumb slides). The words crossfade between steps; reduced motion swaps them.
 */
function StepsCard({ block, level }: { readonly block: Extract<CardBlock, { kind: 'steps' }>; readonly level: 2 | 3 }) {
  const titleId = useId();
  const [shown, setShown] = useState('0');
  const at = Math.min(Number(shown), block.items.length - 1);
  const step = block.items[at] ?? block.items[0];
  const StepTitle = level === 2 ? 'h3' : 'h4';
  return (
    <Card kind="steps" labelledBy={titleId}>
      <CardTitle id={titleId} level={level} icon="list-checks">
        {block.title ?? strings.howIWork}
      </CardTitle>
      {step !== undefined && (
        <div key={shown} className={styles.step}>
          <StepTitle className={styles.stepTitle}>
            <span className={styles.stepNumber}>{strings.stepNumber(at + 1)}</span> {step.title}
          </StepTitle>
          <p className={styles.stepBody}>{step.body}</p>
        </div>
      )}
      <SegmentedControl
        label={strings.steps}
        size="compact"
        segments={block.items.map((item, index) => ({
          value: String(index),
          label: strings.stepNumber(index + 1),
          accessibleLabel: strings.stepName(index + 1, item.title),
        }))}
        value={shown}
        onChange={setShown}
      />
    </Card>
  );
}

/** A location: its name and address, and Directions, which opens the map search in a new tab. */
function LocationCard({
  block,
  level,
  onPress,
}: {
  readonly block: Extract<CardBlock, { kind: 'location' }>;
  readonly level: 2 | 3;
  readonly onPress: (() => void) | undefined;
}) {
  const titleId = useId();
  const directions = webHref(block.directions);
  return (
    <Card kind="location" labelledBy={titleId}>
      <CardTitle id={titleId} level={level} icon="map-pin">
        {block.title ?? strings.location}
      </CardTitle>
      <address className={styles.address}>{block.address}</address>
      {directions !== undefined && (
        <span className={styles.actions}>
          <ButtonLink
            size="touch"
            icon="map-pin"
            href={directions}
            isExternal
            relations={['nofollow']}
            {...(onPress === undefined ? {} : { onPress })}
          >
            {strings.directions}
          </ButtonLink>
        </span>
      )}
    </Card>
  );
}

/**
 * The next events: each one still to come by the page's own clock, soonest first, its day on a small date tile and
 * its time and place under its name; one with a link is the link. When every one has passed, the card says so.
 */
function EventsCard({
  block,
  level,
  onPress,
}: {
  readonly block: Extract<CardBlock, { kind: 'events' }>;
  readonly level: 2 | 3;
  readonly onPress: (() => void) | undefined;
}) {
  const titleId = useId();
  const now = useNow();
  const { locale, timeZone } = useFormatSettings();
  const day = memoIntl(
    `bento-day:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone }),
  );
  const month = memoIntl(
    `bento-month:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone }),
  );
  const when = memoIntl(
    `bento-when:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone }),
  );
  const coming = block.items.filter((event) => Date.parse(event.at) + EVENT_RUNS_MS >= now);
  const date = memoIntl(
    `bento-date:${locale}:${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }),
  );
  return (
    <Card kind="events" labelledBy={titleId}>
      <CardTitle id={titleId} level={level} icon="calendar-days">
        {block.title ?? strings.events}
      </CardTitle>
      {coming.length === 0 ? (
        <p className={styles.quiet}>{strings.noEvents}</p>
      ) : (
        <ul className={styles.pieces}>
          {coming.map((event) => {
            const at = new Date(event.at);
            const href = webHref(event.href);
            const body = (
              <>
                <span className={styles.dateTile} aria-hidden="true">
                  <span className={styles.dateMonth}>{month.format(at)}</span>
                  <span className={styles.dateDay}>{day.format(at)}</span>
                </span>
                <span className={styles.pieceWords}>
                  <span className={styles.rowTitle}>{event.title}</span>
                  <span className={styles.quiet}>
                    <VisuallyHidden>{date.format(at)}, </VisuallyHidden>
                    <time dateTime={event.at}>{when.format(at)}</time>
                    {event.place !== undefined && strings.atPlace(event.place)}
                  </span>
                </span>
                {href !== undefined && (
                  <span className={styles.pieceEnd}>
                    <Icon name="arrow-up-right" size="sm" />
                    <VisuallyHidden>{strings.opensElsewhere}</VisuallyHidden>
                  </span>
                )}
              </>
            );
            return (
              <li key={`${event.at}-${event.title}`} className={styles.pieceItem}>
                {href === undefined ? (
                  <span className={styles.piece}>{body}</span>
                ) : (
                  <a
                    className={styles.piece}
                    data-pressable=""
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={onPress}
                  >
                    {body}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
