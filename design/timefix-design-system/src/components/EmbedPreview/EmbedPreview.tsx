import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { CalendarDays, Check, Copy, MousePointerClick, PanelTop, MessageCircle, PanelRightOpen } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { contrastOnWhiteText } from '../ColorPicker/ColorPicker.tsx';
import { BookingPagePicture, type BookingPagePictureProps } from '../BookingPagePicture/BookingPagePicture.tsx';
import { TextMorph } from '../Motion/Motion.tsx';
import './EmbedPreview.css';

const i14 = { size: 14, strokeWidth: 1.75 } as const;

/** How the page sits on someone's site. */
export type EmbedMode = 'inline' | 'popup' | 'floating' | 'slide';

/** The snippet a site pastes for each way of embedding. */
export function embedSnippet(mode: EmbedMode, url: string, words: string, accent: string): string {
  const script = '<script src="https://timefix.com/embed.js" async></script>';
  if (mode === 'inline') return `<div data-timefix-inline="${url}" style="min-height:640px"></div>\n${script}`;
  if (mode === 'popup') return `<button data-timefix-popup="${url}">${words}</button>\n${script}`;
  if (mode === 'slide') return `<script>\n  window.timefix = { slide: "${url}", text: "${words}", color: "${accent}" };\n</script>\n${script}`;
  return `<script>\n  window.timefix = { floating: "${url}", text: "${words}", color: "${accent}" };\n</script>\n${script}`;
}

/** Props for EmbedPreview. */
export interface EmbedPreviewProps {
  /** The page being embedded, drawn small in the preview. */
  readonly page?: BookingPagePictureProps;
  /** Something else to draw instead of a booking page (a form's picture). */
  readonly picture?: ReactNode;
  /** The ways offered, in order; all but Slide-in by default. */
  readonly modes?: ReadonlyArray<EmbedMode>;
  /** The page sits on the site without its own card: the site's background shows through. */
  readonly isClear?: boolean;
  /** The code to paste, when the consumer builds its own (a form's options in data attributes). */
  readonly snippet?: string;
  readonly url: string;
  /** The words on the popup or floating button. */
  readonly words?: string;
  /** "#RRGGBB" for the floating button. */
  readonly accent?: string;
  /** The made-up site's address in the frame. */
  readonly site?: string;
  readonly mode?: EmbedMode;
  readonly defaultMode?: EmbedMode;
  readonly onModeChange?: (mode: EmbedMode) => void;
}

/** Embed options for a booking page: In the page, Popup button or Floating button, a live preview on a made-up site and the snippet to paste, with Copy. */
const MODE_ITEMS: Readonly<Record<EmbedMode, { readonly label: string; readonly icon: ReactNode }>> = {
  inline: { label: 'In the page', icon: <PanelTop {...i14} /> }, popup: { label: 'Popup button', icon: <MousePointerClick {...i14} /> },
  floating: { label: 'Floating button', icon: <MessageCircle {...i14} /> }, slide: { label: 'Slide-in', icon: <PanelRightOpen {...i14} /> },
};

export function EmbedPreview({ page, picture, modes = ['inline', 'popup', 'floating'], isClear = false, snippet, url, words = 'Book a call', accent = '#1F5FD6', site = 'acme.com/contact', mode, defaultMode = 'inline', onModeChange }: EmbedPreviewProps) {
  const [inner, setInner] = useState<EmbedMode>(defaultMode);
  const now = mode ?? inner;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const code = snippet ?? embedSnippet(now, url, words, accent);
  const art = picture ?? (page ? <BookingPagePicture {...page} /> : null);
  const brand = { '--tf-embed-accent': accent, '--tf-embed-on-accent': contrastOnWhiteText(accent) >= 3 ? 'var(--on-accent)' : 'var(--text)' } as CSSProperties;
  const change = (k: string) => { setInner(k as EmbedMode); setCopied(false); onModeChange?.(k as EmbedMode); };
  const copy = () => { void navigator.clipboard?.writeText(code).catch(() => undefined); setCopied(true); };
  const caption = now === 'inline' ? 'The page sits inside your site' : now === 'popup' ? 'Your button opens the page over your site' : now === 'slide' ? 'A button in the corner slides the page in beside your site' : 'A button stays in the corner on every page';

  return (
    <div className="tf-embed">
      <SegmentedControl aria-label="How it sits on your site" selectedKey={now} onSelectionChange={change} isFullWidth items={modes.map((m) => ({ id: m, label: MODE_ITEMS[m].label, icon: MODE_ITEMS[m].icon }))} />
      <p className="tf-embed__caption">{caption}.</p>

      <figure className="tf-embed__frame" role="img" aria-label={`Preview: ${caption}`} style={brand}>
        <div className="tf-embed__chrome" aria-hidden="true">
          <span className="tf-embed__dots"><span /><span /><span /></span>
          <span className="tf-embed__url">{site}</span>
        </div>
        <div className="tf-embed__site" key={now} aria-hidden="true">
          <span className="tf-embed__nav"><span className="tf-embed__brand" /><span className="tf-embed__line tf-embed__line--s" /><span className="tf-embed__line tf-embed__line--s" /></span>
          <span className="tf-embed__line tf-embed__line--h" />
          <span className="tf-embed__line" />
          <span className="tf-embed__line tf-embed__line--m" />
          {now === 'inline' && <div className="tf-embed__inline" data-clear={isClear || undefined}>{art}</div>}
          {now === 'popup' && (
            <>
              <span className="tf-embed__site-btn">{words}</span>
              <div className="tf-embed__popup-scrim"><div className="tf-embed__popup">{art}</div></div>
            </>
          )}
          {now === 'slide' && (
            <>
              <span className="tf-embed__line tf-embed__line--m" />
              <div className="tf-embed__slide">{art}</div>
              <span className="tf-embed__float tf-embed__float--slide"><PanelRightOpen {...i14} />{words}</span>
            </>
          )}
          {now === 'floating' && (
            <>
              <span className="tf-embed__line tf-embed__line--m" />
              <span className="tf-embed__line" />
              <span className="tf-embed__float"><CalendarDays {...i14} />{words}</span>
            </>
          )}
        </div>
      </figure>

      <div className="tf-embed__code">
        <div className="tf-embed__codehead">
          <span className="tf-embed__codetitle">Paste this into your site’s HTML</span>
        <Button size="sm" variant="secondary" onPress={copy} className="tf-embed__copy"
          icon={<span className="tf-embed__icon" data-copied={copied || undefined}><Copy {...i14} className="tf-embed__icon-a" /><Check {...i14} className="tf-embed__icon-b" /></span>}>
          <TextMorph text={copied ? 'Copied' : 'Copy code'} />
        </Button>
        </div>
        <pre className="tf-embed__pre" key={now} tabIndex={0} aria-label="Embed code"><code>{code}</code></pre>
        <span className="tf-sr-only" role="status">{copied ? 'Code copied' : ''}</span>
      </div>
    </div>
  );
}
