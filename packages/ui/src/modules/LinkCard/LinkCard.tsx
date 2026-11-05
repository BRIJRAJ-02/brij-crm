import { useId, useRef, type ReactNode } from 'react';
import { Link as AriaLink } from 'react-aria-components';
import { Badge } from '../../atoms/Badge/Badge.tsx';
import { CopyButton } from '../../atoms/Button/CopyButton.tsx';
import { Skeleton } from '../../atoms/Skeleton/Skeleton.tsx';
import { StatusDot } from '../../atoms/StatusDot/StatusDot.tsx';
import { Switch } from '../../atoms/Switch/Switch.tsx';
import { Tooltip } from '../../atoms/Tooltip/Tooltip.tsx';
import type { Hue } from '../../hue.ts';
import { safeHref } from '../../lib/safe-href.ts';
import { linkHue } from '../../lib/stable-hue.ts';
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
  /** What it does, in a few words, shown in a tooltip while it can be switched ("Accepting submissions"). */
  readonly hint?: string;
}

/** Props for LinkCard. */
export interface LinkCardProps {
  readonly title: string;
  /**
   * Where the card goes: the link's editor. The whole card opens it. Left out (a copy still on its way), the
   * card doesn't open.
   */
  readonly href?: string;
  /** The link's own hue, a small dot before the title. Left out (and no `colourKey`), no dot (a form). */
  readonly hue?: Hue;
  /**
   * For a link with no hue of its own (a booking page today): a stable id the dot takes its colour from, so
   * the same link keeps the same colour everywhere. Grey and red (which reads as an error) are left out.
   */
  readonly colourKey?: string;
  /** The title's heading level: 2 on a page whose h1 is the TopBar (Captures), 3 inside a section (default). */
  readonly titleLevel?: 2 | 3;
  /** Short facts on one line under the title ("30 min · One on one"; "12 submissions · 2 spam"). */
  readonly facts: readonly string[];
  /**
   * The public link, muted ("/b/k3x9", "/f/contact-us"). It can be selected, and Copy link selects it if the
   * clipboard refuses. Left out when there is no link yet (a form never published).
   */
  readonly address?: string;
  /** A state the switch can't say, beside the title ("Not published", "Private", "Copying"). Never "Off". */
  readonly badge?: string;
  /** Off (not taking people): the card reads quieter, its title muted. Its dot keeps its colour: the dot never says a state. */
  readonly isOff?: boolean;
  /** Shown before the server made it: quieter still, and nothing in it works yet. */
  readonly isPending?: boolean;
  readonly toggle?: LinkCardToggle;
  /** The public link Copy link copies. Left out (a form not published yet: there is nothing to copy), no Copy link. */
  readonly copyValue?: string;
  /** Copy link as a quiet ghost icon (named by its label and tooltip) rather than a labelled button: a card with a picture. */
  readonly isCopyQuiet?: boolean;
  /** Open and the ··· menu: ghost icon Buttons at the footer's end, 8px apart. */
  readonly actions?: ReactNode;
  /**
   * What the link opens, drawn small on a stage across the card's top (5 November 2026, the owner: "make these cards
   * look much prettier"): a form's name and first questions as shapes (`FormPicture`), a booking page's month
   * (`BookingPagePicture`). It sits on a sheet that lifts on hover; it is hidden from assistive tech and takes no
   * press of its own, so a press on it opens the card.
   */
  readonly picture?: ReactNode;
  /** The link's state as a dot and a word at the start of the facts line ("Live", "Draft", "Paused"). */
  readonly status?: { readonly label: string; readonly hue: Hue };
  /** The footer's start, in the address's place: one quiet control of the card's own (a draft form's Edit). */
  readonly lead?: ReactNode;
  /**
   * The facts line's end, after a middle dot: one quiet control of the card's own, above the card's link (a form's
   * "12 submissions" as a quiet Link, with its New badge), so the foot keeps the address as a booking card's does.
   */
  readonly factsEnd?: ReactNode;
}

/**
 * One link as a card (spec 0025's links, spec 0023's forms; the owner's card grid, 20 October 2026; restyled
 * 4 November 2026; a picture of what it opens across its top, 5 November 2026): a small colour dot and the title (a link over the whole card to its editor) with a state
 * badge, the on or off switch at the top end, the facts, then one footer line with the public link at its start
 * and Copy link and the card's actions at its end. The controls sit above the card's link, so each does its own
 * thing and stays in the tab order after the title.
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
  isCopyQuiet = false,
  actions,
  picture,
  status,
  lead,
  factsEnd,
}: LinkCardProps) {
  const titleId = useId();
  const addressRef = useRef<HTMLParagraphElement>(null);
  const edge = hue ?? (colourKey === undefined ? undefined : linkHue(colourKey));
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
      data-pictured={picture === undefined ? undefined : ''}
    >
      {picture !== undefined && (
        // What the link opens, small: a picture only (the title names the card), so it is hidden and inert, and a
        // press on it lands on the title's link under it.
        <div className={styles.stage} aria-hidden="true" inert>
          <div className={styles.sheet}>{picture}</div>
        </div>
      )}
      <div className={styles.body}>
        <div className={styles.head}>
          <div className={styles.titleRow}>
            {/* The link's colour, as a small quiet dot before its title: a mark, never a state. */}
            {edge !== undefined && <span className={styles.dot} data-dot="" aria-hidden="true" />}
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
        {(facts.length > 0 || status !== undefined || factsEnd !== undefined) && (
          <p className={styles.facts}>
            {status !== undefined && <StatusDot hue={status.hue}>{status.label}</StatusDot>}
            {facts.length > 0 && <span className={styles.factsText}>{facts.join(' · ')}</span>}
            {factsEnd !== undefined && <span className={styles.factsEnd}>{factsEnd}</span>}
          </p>
        )}
      </div>
      {(hasFoot || address !== undefined || lead !== undefined) && (
        <div className={styles.foot} role="group" aria-label={strings.actionsFor(title)}>
          {/* The public link sits where it is copied from, so the card spends one line on it, not two. */}
          {lead !== undefined ? (
            <div className={styles.lead}>{lead}</div>
          ) : address !== undefined ? (
            <p ref={addressRef} className={styles.address}>
              {address}
            </p>
          ) : (
            <span className={styles.spacer} />
          )}
          {copyValue !== undefined && (
            <span className={styles.control}>
              {isCopyQuiet ? (
                <Tooltip content={strings.copyLink}>
                  <CopyButton
                    value={copyValue}
                    label={strings.copyLink}
                    announcement={strings.linkCopied}
                    isDisabled={isPending}
                    size="lg"
                    variant="ghost"
                    isIconOnly
                    sourceRef={addressRef}
                  />
                </Tooltip>
              ) : (
                <CopyButton
                  value={copyValue}
                  label={strings.copyLink}
                  announcement={strings.linkCopied}
                  isDisabled={isPending}
                  size="lg"
                  sourceRef={addressRef}
                />
              )}
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
  // Disabled, the tooltip says why; otherwise, when it has one, what it does.
  const tip = isDisabled ? toggle.disabledReason : toggle.hint;
  if (tip === undefined) return <span className={styles.control}>{control}</span>;
  return (
    <Tooltip content={tip} isTextTrigger>
      <span className={styles.control}>{control}</span>
    </Tooltip>
  );
}

/** A card standing in while the grid loads: the same shape, its lines as skeletons, with the picture's stage when the cards have one. */
export function LinkCardSkeleton({ hasPicture = false }: { readonly hasPicture?: boolean }) {
  return (
    <div className={styles.root} data-loading="" aria-hidden="true">
      {hasPicture && <div className={styles.stage} />}
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
