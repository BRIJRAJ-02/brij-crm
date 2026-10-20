import { useId, useRef, type ReactNode } from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import { HUES, type Hue } from '../../hue.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { stableHue } from '../../lib/stable-hue.ts';
import styles from './LinkCard.module.css';
import { strings } from './strings.ts';

/** A card's on or off switch: a booking page's visibility, a form's Accepting. */
export interface LinkCardToggle {
  /** Its name for screen readers ("Intro call is on"). */
  readonly label: string;
  readonly isSelected: boolean;
  readonly onChange: (isSelected: boolean) => void;
  /** Can't be switched (never published, no permission, still on its way). */
  readonly isDisabled?: boolean;
  /** Why it can't, shown in a tooltip on the switch ("Publish it first"). */
  readonly disabledReason?: string;
}

/** Props for LinkCard. */
export interface LinkCardProps {
  readonly title: string;
  /**
   * Where the card goes: the link's editor. The whole card opens it. Left out (a copy still on its way), the
   * card doesn't open.
   */
  readonly href?: string;
  /** The colour edge on the start side: the link's own hue. Left out (and no `colourKey`), a neutral edge (a form). */
  readonly hue?: Hue;
  /**
   * For a link with no hue of its own (a booking page today): a stable id the edge takes its colour from, so
   * the same link keeps the same colour everywhere. Grey (the neutral edge) and red (which reads as an error)
   * are left out.
   */
  readonly colourKey?: string;
  /** The title's heading level: 2 on a page whose h1 is the TopBar (Captures), 3 inside a section (default). */
  readonly titleLevel?: 2 | 3;
  /** Short facts on one line under the title ("30 min · One on one"; "12 submissions · 2 spam"). */
  readonly facts: readonly string[];
  /** The public link, muted ("/b/k3x9", "/f/contact-us"). It can be selected, and Copy link selects it if the clipboard refuses. */
  readonly address: string;
  /** A state the switch can't say, beside the title ("Not published", "Private", "Copying…"). Never "Off". */
  readonly badge?: string;
  /** Off (not taking people): the card reads quieter, its title muted. Its edge keeps its colour: the edge never says a state. */
  readonly isOff?: boolean;
  /** Shown before the server made it: quieter still, and nothing in it works yet. */
  readonly isPending?: boolean;
  readonly toggle?: LinkCardToggle;
  /** The public link Copy link copies. Left out (a form not published yet: there is nothing to copy), no Copy link. */
  readonly copyValue?: string;
  /** Open and the ··· menu: ghost icon Buttons at the footer's end, 8px apart. */
  readonly actions?: ReactNode;
}

/**
 * One link as a card (spec 0025's links, spec 0023's forms; the owner's card grid, 20 October 2026): a colour
 * edge, the title (a link over the whole card to its editor) with a state badge, the on or off switch at the
 * top end, the facts and the public link, then a footer with Copy link and the card's actions. The controls
 * sit above the card's link, so each does its own thing and stays in the tab order after the title.
 */
export function LinkCard({
  title,
  href,
  hue,
  colourKey,
  titleLevel = 3,
  facts,
  address,
  badge,
  isOff = false,
  isPending = false,
  toggle,
  copyValue,
  actions,
}: LinkCardProps) {
  const titleId = useId();
  const addressRef = useRef<HTMLParagraphElement>(null);
  const edge = hue ?? (colourKey === undefined ? undefined : stableHue(colourKey, EDGE_HUES));
  const Heading = titleLevel === 2 ? 'h2' : 'h3';
  const safe = href === undefined || isPending ? undefined : safeHref(href);
  const hasFoot = copyValue !== undefined || (actions !== undefined && actions !== null && actions !== false);
  return (
    <article
      className={styles.root}
      aria-labelledby={titleId}
      data-hue={edge}
      data-off={isOff || undefined}
      data-pending={isPending || undefined}
    >
      <div className={styles.body}>
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <Heading className={styles.heading}>
              {safe === undefined ? (
                <span id={titleId} className={styles.title}>
                  {title}
                </span>
              ) : (
                <AriaLink id={titleId} className={styles.title} href={safe}>
                  {title}
                </AriaLink>
              )}
            </Heading>
            {badge !== undefined && <Badge text={badge} />}
          </div>
          {toggle !== undefined && <CardSwitch toggle={toggle} isPending={isPending} />}
        </div>
        {facts.length > 0 && <p className={styles.facts}>{facts.join(' · ')}</p>}
        <p ref={addressRef} className={styles.address}>
          {address}
        </p>
      </div>
      {hasFoot && (
        <div className={styles.foot} role="group" aria-label={strings.actionsFor(title)}>
          {copyValue !== undefined && (
            <span className={styles.control}>
              <CopyButton
                value={copyValue}
                label={strings.copyLink}
                isDisabled={isPending}
                size="lg"
                sourceRef={addressRef}
              />
            </span>
          )}
          {actions !== undefined && actions !== null && actions !== false && (
            <div className={styles.actions}>{actions}</div>
          )}
        </div>
      )}
    </article>
  );
}

/** The hues a link's edge may take from its `colourKey`: every data hue but grey (neutral) and red (an error). */
const EDGE_HUES = HUES.filter((hue) => hue !== 'gray' && hue !== 'red');

/** The card's switch, with the reason it is off limits in a tooltip when it is. */
function CardSwitch({ toggle, isPending }: { readonly toggle: LinkCardToggle; readonly isPending: boolean }) {
  const isDisabled = isPending || toggle.isDisabled === true;
  const control = (
    <Switch
      label={toggle.label}
      isLabelHidden
      isSelected={toggle.isSelected}
      onChange={toggle.onChange}
      isDisabled={isDisabled}
    />
  );
  if (!isDisabled || toggle.disabledReason === undefined) return <span className={styles.control}>{control}</span>;
  return (
    <Tooltip content={toggle.disabledReason} isTextTrigger>
      <span className={styles.control}>{control}</span>
    </Tooltip>
  );
}

/** A card standing in while the grid loads: the same shape, its lines as skeletons. */
export function LinkCardSkeleton() {
  return (
    <div className={styles.root} data-loading="" aria-hidden="true">
      <div className={styles.body}>
        <span className={styles.skeletonTitle}>
          <Skeleton width="medium" />
        </span>
        <Skeleton width="short" />
        <Skeleton width="medium" />
      </div>
      <div className={styles.foot}>
        <span className={styles.skeletonButton}>
          <Skeleton width="short" />
        </span>
      </div>
    </div>
  );
}
