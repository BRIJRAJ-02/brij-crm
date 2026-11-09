import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Copy, ExternalLink, Code2, CopyPlus, MoreHorizontal, Pencil, Trash2, MapPin, Phone, Video } from 'lucide-react';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Button, IconButton } from '../Button/Button.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSeparator } from '../Menu/Menu.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { IconSwap, TextSwap, TextMorph } from '../Motion/Motion.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import { cx } from '../../lib/cx.ts';
import './BookingPagePicture.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
const i14 = { size: 14, strokeWidth: 1.75 } as const;

/** Props for BookingPagePicture: only the page's own words and hours, nothing it fetches. */
export interface BookingPagePictureProps {
  readonly host: string;
  readonly title: string;
  /** "30 min" or "30 or 60 min". */
  readonly duration: string;
  /** Seven booleans, Monday first: the days the page's weekly hours open. */
  readonly openDays: ReadonlyArray<boolean>;
  /** The page's colour, the same as its dot in the list. */
  readonly hue?: Hue;
}

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A booking page in miniature: the host's face, the title, the length and a week whose open days wear the page's colour. A picture, never a control. */
export function BookingPagePicture({ host, title, duration, openDays, hue = 'blue' }: BookingPagePictureProps) {
  const picked = openDays.findIndex(Boolean);
  const style = { '--tf-bpp-soft': `var(--tag-${hue}-bg)`, '--tf-bpp-ink': `var(--tag-${hue}-text)`, '--tf-bpp-solid': `var(--dot-${hue})` } as CSSProperties;
  return (
    <div className="tf-bpp" style={style} aria-hidden="true">
      <div className="tf-bpp__sheet">
        <div className="tf-bpp__head">
          <Avatar name={host} size={20} />
          <span className="tf-bpp__host">{host}</span>
        </div>
        <span className="tf-bpp__title">{title}</span>
        <span className="tf-bpp__len tf-num">{duration}</span>
        <span className="tf-bpp__week">
          {WEEK.map((d, n) => (
            <span key={n} className="tf-bpp__day" data-open={openDays[n] || undefined} data-picked={n === picked || undefined}>{d}</span>
          ))}
        </span>
      </div>
    </div>
  );
}

/** Where the meeting happens, as the card's sub-line says it. */
export interface BookingPageLocation { readonly kind: 'video' | 'phone' | 'place'; readonly label: string }

/** Props for BookingPageCard. */
export interface BookingPageCardProps extends BookingPagePictureProps {
  readonly location: BookingPageLocation;
  /** The public link, copied by Copy link. */
  readonly url: string;
  readonly isOn: boolean;
  readonly onOnChange: (isOn: boolean) => void;
  /** Edit, Duplicate, Embed, Open or Delete. */
  readonly onAction?: (action: 'edit' | 'duplicate' | 'embed' | 'open' | 'delete') => void;
}

/** One booking page on the Pages list: its picture, name, length and place, On or Hidden, Copy link and a menu of the rest. */
export function BookingPageCard({ location, url, isOn, onOnChange, onAction, ...picture }: BookingPageCardProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
  };
  const Where = location.kind === 'video' ? Video : location.kind === 'phone' ? Phone : MapPin;
  return (
    <article className={cx('tf-bpcard', !isOn && 'tf-bpcard--hidden')} aria-label={picture.title}>
      <div className="tf-bpcard__picture"><BookingPagePicture {...picture} /></div>
      <div className="tf-bpcard__body">
        <h3 className="tf-bpcard__name">{picture.title}</h3>
        <p className="tf-bpcard__sub">
          <span className="tf-num">{picture.duration}</span>
          <span aria-hidden="true">·</span>
          <Where {...i14} aria-hidden />
          <span className="tf-bpcard__where">{location.label}</span>
        </p>
      </div>
      <div className="tf-bpcard__foot">
        <Switch isSelected={isOn} onChange={onOnChange} aria-label={`${picture.title} is open to guests`}>
          <TextSwap swapKey={isOn ? 'on' : 'off'}>{isOn ? 'On' : 'Hidden'}</TextSwap>
        </Switch>
        <span className="tf-bpcard__actions">
          <Button size="sm" variant="secondary" onPress={copy} isDisabled={!isOn}
            icon={<IconSwap isB={copied} a={<Copy {...i14} />} b={<span className="tf-bpcard__copied"><Check {...i14} /></span>} />}>
            <TextMorph text={copied ? 'Copied' : 'Copy link'} />
          </Button>
          <MenuTrigger>
            <IconButton label={`More for ${picture.title}`} size="sm"><MoreHorizontal {...i16} /></IconButton>
            <Menu aria-label={`More for ${picture.title}`} placement="bottom end" onAction={(k) => onAction?.(String(k) as 'edit')}>
              <MenuItem id="edit" icon={<Pencil {...i16} />}>Edit</MenuItem>
              <MenuItem id="open" icon={<ExternalLink {...i16} />}>Open page</MenuItem>
              <MenuItem id="embed" icon={<Code2 {...i16} />}>Embed on a site</MenuItem>
              <MenuItem id="duplicate" icon={<CopyPlus {...i16} />}>Duplicate</MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon={<Trash2 {...i16} />} isDanger>Delete</MenuItem>
            </Menu>
          </MenuTrigger>
        </span>
      </div>
      <span className="tf-sr-only" role="status">{copied ? 'Link copied' : ''}</span>
    </article>
  );
}
