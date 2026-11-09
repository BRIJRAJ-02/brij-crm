import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { Logo } from '../Logo/Logo.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { MeetingCard, type Meeting } from '../MeetingList/MeetingList.tsx';
import { Skeleton } from '../Motion/Motion.tsx';
import './AuthLayout.css';

/** Props for AuthLayout. */
export interface AuthLayoutProps {
  /** The page's task: SignInForm, a join form, first run's steps. */
  readonly children: ReactNode;
  /** Draws the page as a full-screen left/right split with this on the right (a calm product sketch). Left out, the task sits in a centred card. */
  readonly preview?: ReactNode;
  /** Quiet links at the foot: Terms, Privacy, Help (AuthFooterLink), or Sign out. */
  readonly footer?: ReactNode;
  /** Who is signed in, said at the start of the footer ("Signed in as priya@northwind.com"). */
  readonly account?: string;
  /** The session is still being checked: skeleton lines stand in for the task and the card is `aria-busy`. */
  readonly isBusy?: boolean;
  /** Names the region when the task's heading is not enough. */
  readonly 'aria-label'?: string;
}

/** The shell of every page before the app: the Timefix logo top left, the task centred (card) or in the left half of a split with a live preview on the right, quiet links at the foot. Fills its container. */
export function AuthLayout({ children, preview, footer, account, isBusy = false, 'aria-label': ariaLabel }: AuthLayoutProps) {
  const split = preview !== undefined;
  return (
    <div className={cx('tf-auth', split ? 'tf-auth--split' : 'tf-auth--card')}>
      <div className="tf-auth__frame">
        <div className="tf-auth__main">
          <div className="tf-auth__top"><Logo size={24} /></div>
          <section className="tf-auth__body" aria-label={ariaLabel} aria-busy={isBusy || undefined}>
            <div className="tf-auth__task">
              {isBusy ? (
                <div className="tf-auth__busy" aria-hidden="true">
                  <Skeleton width="60%" height={24} /><Skeleton width="85%" height={14} />
                  <Skeleton height={44} /><Skeleton height={44} />
                </div>
              ) : children}
            </div>
          </section>
          {(footer !== undefined || account !== undefined) && (
            <footer className="tf-auth__foot">
              {account !== undefined && <span className="tf-auth__account">Signed in as <span className="tf-auth__email">{account}</span></span>}
              {footer !== undefined && <nav className="tf-auth__links" aria-label="More">{footer}</nav>}
            </footer>
          )}
        </div>
        {split && <aside className="tf-auth__preview" aria-hidden="true" inert>{preview}</aside>}
      </div>
    </div>
  );
}

/** A quiet link in AuthLayout's footer. With `onPress` and no `href` it is a button (Sign out). */
export function AuthFooterLink({ href, onPress, children }: { readonly href?: string; readonly onPress?: () => void; readonly children: ReactNode }) {
  if (href !== undefined) return <a className="tf-auth__link" href={href}>{children}</a>;
  return <button type="button" className="tf-auth__link" onClick={onPress}>{children}</button>;
}

/** The page heading and its one line, revealed as staggered lines (transitions.dev 18: 12px rise, 3px blur, 500ms, 40ms apart). A new `title` replays it. */
export function AuthHeading({ title, description, eyebrow, id }: { readonly title: string; readonly description?: ReactNode; readonly eyebrow?: ReactNode; readonly id?: string }) {
  return (
    <div className="tf-auth-head" key={title}>
      {eyebrow !== undefined && <p className="tf-auth-head__eyebrow tf-auth-head__line">{eyebrow}</p>}
      <h1 id={id} className="tf-auth-head__title tf-auth-head__line" tabIndex={-1}>{title}</h1>
      {description !== undefined && <p className="tf-auth-head__desc tf-auth-head__line tf-auth-head__line--2">{description}</p>}
    </div>
  );
}

/** Props for AuthPages. */
export interface AuthPagesProps {
  /** The page showing; earlier pages wait to the left, later ones to the right. */
  readonly index: number;
  readonly children: readonly ReactNode[];
  /** Names the group of pages for assistive tech. */
  readonly 'aria-label'?: string;
}

/**
 * Pages of one task that slide side by side (transitions.dev 08: 8px, 3px blur, 250ms) while the box eases to the new
 * page's height (01 card resize). Every page stays mounted so the slide runs both ways; the hidden ones are inert.
 * On a change, focus moves to the new page's first field, else its heading.
 */
export function AuthPages({ index, children, 'aria-label': ariaLabel }: AuthPagesProps) {
  const refs = useRef<Array<HTMLElement | null>>([]);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = refs.current[index];
    if (!el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [index]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = refs.current[index];
    const target = el?.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), textarea') ?? el?.querySelector<HTMLElement>('h1, h2');
    target?.focus({ preventScroll: true });
  }, [index]);
  return (
    <div className="tf-auth-pages" style={{ height } as CSSProperties} role="group" aria-label={ariaLabel}>
      {children.map((page, i) => (
        <section key={i} ref={(el) => { refs.current[i] = el; }} className="tf-auth-pages__page"
          data-state={i < index ? 'before' : i > index ? 'after' : 'current'} inert={i !== index} aria-hidden={i !== index}>
          {page}
        </section>
      ))}
    </div>
  );
}

const day = (h: number, m: number) => new Date(2026, 10, 11, h, m);
const SAMPLE: ReadonlyArray<Meeting> = [
  { id: 'p1', start: day(10, 30), end: day(11, 0), title: 'Discovery call', invitee: { name: 'Sam Kim', email: 'sam@northwind.com' }, place: 'video', placeLabel: 'Google Meet', status: 'confirmed' },
  { id: 'p2', start: day(13, 0), end: day(13, 45), title: 'Demo', invitee: { name: 'Ava Chen', email: 'ava@globex.com' }, guests: ['Jo Mendes'], place: 'video', placeLabel: 'Zoom', status: 'confirmed' },
  { id: 'p3', start: day(16, 0), end: day(16, 30), title: 'Renewal check-in', invitee: { name: 'Maria Bell', email: 'maria@acme.com' }, place: 'phone', placeLabel: 'Phone call', status: 'pending' },
];

/** The calm sketch on the right of sign in: a workspace's day as real MeetingCards, cut off at the panel's edge. Decorative. */
export function AuthPreview({ workspace = 'Northwind', meetings = SAMPLE }: { readonly workspace?: string; readonly meetings?: ReadonlyArray<Meeting> }) {
  return (
    <div className="tf-auth-sketch">
      <div className="tf-auth-sketch__head">
        <Avatar name={workspace} shape="square" size={28} />
        <span className="tf-auth-sketch__name">{workspace}</span>
        <span className="tf-auth-sketch__day">Today</span>
      </div>
      <div className="tf-auth-sketch__cards">
        {meetings.map((m, i) => (
          <div key={m.id} className="tf-auth-sketch__card" style={{ '--tf-i': i } as CSSProperties}>
            <MeetingCard meeting={m} strip={i === 0 ? { tone: 'success', text: 'Starts in 10 min', action: 'Join' } : undefined} />
          </div>
        ))}
      </div>
    </div>
  );
}
