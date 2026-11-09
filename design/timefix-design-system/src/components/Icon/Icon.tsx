import type { LucideIcon } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { LogoMark } from '../Logo/Logo.tsx';
import googleG from './marks/google-g.svg';
import googleCalendar from './marks/google-calendar.svg';
import googleMeet from './marks/google-meet.svg';
import outlook from './marks/outlook.svg';
import microsoft from './marks/microsoft.svg';
import appleCalendar from './marks/apple-calendar.svg';
import zoom from './marks/zoom.svg';
import slack from './marks/slack.svg';
import whatsapp from './marks/whatsapp.svg';
import linkedin from './marks/social-linkedin.svg';
import xLight from './marks/social-x-light.svg';
import xDark from './marks/social-x-dark.svg';
import instagram from './marks/social-instagram.svg';
import githubLight from './marks/social-github-light.svg';
import githubDark from './marks/social-github-dark.svg';
import facebook from './marks/social-facebook.svg';
import youtube from './marks/social-youtube.svg';
import angellistLight from './marks/social-angellist-light.svg';
import angellistDark from './marks/social-angellist-dark.svg';
import tiktokLight from './marks/social-tiktok-light.svg';
import tiktokDark from './marks/social-tiktok-dark.svg';
import threadsLight from './marks/social-threads-light.svg';
import threadsDark from './marks/social-threads-dark.svg';
import './Icon.css';

/** Icon sizes: 12 card footers and meta, 14 inside small controls and chips, 16 the default, 20 empty states and tiles. */
export type IconSize = 12 | 14 | 16 | 20;

/** Props for Icon. */
export interface IconProps {
  /** The Lucide glyph, imported by name: `import { Calendar } from 'lucide-react'`. */
  readonly icon: LucideIcon;
  readonly size?: IconSize;
  /** Names the icon for screen readers. Give it only when the icon stands alone; otherwise it is decoration. */
  readonly label?: string;
  /** `muted` is text-secondary, `faint` text-tertiary, `ai` the AI sparkle only; default takes the parent's colour. */
  readonly tone?: 'inherit' | 'muted' | 'faint' | 'ai' | 'success' | 'danger';
  readonly className?: string;
}

/** The one way to draw a Lucide icon: sized from the scale, stroked at 1.75, decorative unless labelled. */
export function Icon({ icon: Glyph, size = 16, label, tone = 'inherit', className }: IconProps) {
  const named = label !== undefined && label !== '';
  return (
    <Glyph
      className={cx('tf-icon', tone !== 'inherit' && `tf-icon--${tone}`, className)}
      size={size}
      strokeWidth={1.75}
      absoluteStrokeWidth={false}
      focusable="false"
      {...(named ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}

/** Every brand a mark is drawn for: sign in, calendars, video calls, chat, Timefix itself, and social profiles. */
export type ProviderName =
  | 'google' | 'google-calendar' | 'google-meet' | 'outlook' | 'microsoft' | 'apple-calendar'
  | 'zoom' | 'slack' | 'whatsapp' | 'timefix'
  | 'linkedin' | 'x' | 'instagram' | 'github' | 'facebook' | 'youtube' | 'angellist' | 'tiktok' | 'threads';

/** Each brand's name, read when a mark stands alone. */
export const PROVIDER_NAMES: Readonly<Record<ProviderName, string>> = {
  google: 'Google', 'google-calendar': 'Google Calendar', 'google-meet': 'Google Meet', outlook: 'Outlook', microsoft: 'Microsoft',
  'apple-calendar': 'Apple Calendar', zoom: 'Zoom', slack: 'Slack', whatsapp: 'WhatsApp', timefix: 'Timefix',
  linkedin: 'LinkedIn', x: 'X', instagram: 'Instagram', github: 'GitHub', facebook: 'Facebook', youtube: 'YouTube',
  angellist: 'AngelList', tiktok: 'TikTok', threads: 'Threads',
};

type Art = string | { readonly light: string; readonly dark: string };
/** The artwork as published (main's files); black marks have a light and a dark file, swapped by theme. Timefix draws LogoMark. */
const ART: Readonly<Record<Exclude<ProviderName, 'timefix'>, Art>> = {
  google: googleG, 'google-calendar': googleCalendar, 'google-meet': googleMeet, outlook, microsoft, 'apple-calendar': appleCalendar,
  zoom, slack, whatsapp, linkedin, x: { light: xLight, dark: xDark }, instagram, github: { light: githubLight, dark: githubDark },
  facebook, youtube, angellist: { light: angellistLight, dark: angellistDark }, tiktok: { light: tiktokLight, dark: tiktokDark },
  threads: { light: threadsLight, dark: threadsDark },
};
const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Props for ProviderMark. */
export interface ProviderMarkProps {
  readonly provider: ProviderName;
  /** 14 beside a small button's label, 16 (default) in rows and buttons, 20 in tiles, 24 where an avatar would sit. */
  readonly size?: 14 | 16 | 20 | 24;
  /** Names the mark for screen readers ("Google Calendar") when no label beside it already does. */
  readonly isLabelled?: boolean;
  /** `brand` draws the artwork as published; `mono` only its shape in the text colour, for a row of marks that must read as one set. */
  readonly tone?: 'brand' | 'mono';
}

/** A brand's own mark beside Lucide, the one exception to Lucide only. The artwork is never recoloured, except as `mono`. */
export function ProviderMark({ provider, size = 16, isLabelled = false, tone = 'brand' }: ProviderMarkProps) {
  const a11y = isLabelled ? ({ role: 'img', 'aria-label': PROVIDER_NAMES[provider] } as const) : ({ 'aria-hidden': true } as const);
  const style = { '--tf-mark': `${size}px` } as React.CSSProperties;
  if (provider === 'timefix') {
    return <span className="tf-mark tf-mark--slot" style={style} {...a11y}><LogoMark size={size} /></span>;
  }
  const art = ART[provider];
  if (tone === 'mono') {
    const shape = typeof art === 'string' ? art : art.light;
    return <span className="tf-mark tf-mark--mono" style={{ ...style, '--tf-mark-shape': `url("${uri(shape)}")` } as React.CSSProperties} {...a11y} />;
  }
  if (typeof art === 'string') {
    return <img className="tf-mark" style={style} src={uri(art)} alt={isLabelled ? PROVIDER_NAMES[provider] : ''} />;
  }
  return (
    <span className="tf-mark tf-mark--slot" style={style} {...a11y}>
      <img className="tf-mark tf-mark--light" style={style} src={uri(art.light)} alt="" />
      <img className="tf-mark tf-mark--dark" style={style} src={uri(art.dark)} alt="" />
    </span>
  );
}
