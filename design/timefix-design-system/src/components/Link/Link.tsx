import type { ReactNode } from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { ArrowUpRight } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { VisuallyHidden } from '../Text/Text.tsx';
import './Link.css';

/** An href that is safe to render: an app path, a fragment, or http(s), mailto or tel. Anything else (a `javascript:` URL) is refused. */
export function safeHref(href: string): string | undefined {
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//')) return h;
  if (h.startsWith('#')) return h;
  return /^(https?:|mailto:|tel:)/i.test(h) ? h : undefined;
}
/** True for a link that leaves the app (http or https). */
export function isExternal(href: string): boolean {
  return /^https?:/i.test(href.trim());
}

/** Props for Link. */
export interface LinkProps {
  /** An app path (`/people/1`), a fragment, or an `http`, `https`, `mailto` or `tel` link. Anything else renders as text. */
  readonly href?: string;
  readonly children: ReactNode;
  /** Does something in the page instead of going anywhere; keeps the link's look and keys. */
  readonly onPress?: () => void;
  /** `muted` sits in grey meta lines and turns ink on hover; default is the link colour. */
  readonly variant?: 'default' | 'muted';
  /** `strong` for a link that is the line's action rather than a reference. */
  readonly weight?: 'regular' | 'strong';
  /** Opens in a new tab with the arrow-up-right mark. On by default for http(s) links. */
  readonly isExternal?: boolean;
  /** A name for screen readers when the words alone are ambiguous ("12 submissions to Contact us"). */
  readonly label?: string;
  /** Placement only (margins, alignment); the look stays the library's. */
  readonly className?: string;
}

/** An inline text link: link colour, underline easing in on hover. Links out open in a new tab with an arrow and say so. */
export function Link({ href, children, onPress, variant = 'default', weight = 'regular', isExternal: external, label, className }: LinkProps) {
  const cls = cx('tf-link', `tf-link--${variant}`, weight === 'strong' && 'tf-link--strong', className);
  if (onPress) return <AriaLink className={cls} onPress={onPress} aria-label={label}>{children}</AriaLink>;
  const safe = href === undefined ? undefined : safeHref(href);
  if (safe === undefined) return <span>{children}</span>;
  const out = external ?? isExternal(safe);
  if (!out) return <AriaLink className={cls} href={safe} aria-label={label}>{children}</AriaLink>;
  return (
    <AriaLink className={cls} href={safe} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {children}
      <ArrowUpRight className="tf-link__out" size={14} strokeWidth={1.75} aria-hidden="true" />
      <VisuallyHidden isInline> (opens in a new tab)</VisuallyHidden>
    </AriaLink>
  );
}

/** Props for LearnMoreLink. */
export interface LearnMoreLinkProps {
  readonly href?: string;
  readonly onPress?: () => void;
  /** "Learn more" unless given: "See all", "Continue". */
  readonly children?: ReactNode;
  readonly label?: string;
}

/** "Learn more" with a chevron that slides and opens into an arrow on hover (transitions.dev 24). */
export function LearnMoreLink({ href, onPress, children = 'Learn more', label }: LearnMoreLinkProps) {
  const safe = href === undefined ? undefined : safeHref(href);
  const out = safe !== undefined && isExternal(safe);
  return (
    <AriaLink className="tf-learn" href={safe} onPress={onPress} aria-label={label} {...(out ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
      <span className="tf-learn__chevron" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <path className="tf-learn__arm tf-learn__arm--top" d="M6 4L10 8" />
          <path className="tf-learn__arm tf-learn__arm--bot" d="M10 8L6 12" />
        </svg>
      </span>
      {out && <VisuallyHidden isInline> (opens in a new tab)</VisuallyHidden>}
    </AriaLink>
  );
}
