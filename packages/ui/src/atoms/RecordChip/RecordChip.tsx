import type { ActorDisplay, RecordRefDisplay } from '@crm/contracts/values';
import { Link as AriaLink } from 'react-aria-components';
import { safeHref } from '../../lib/safe-href.ts';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Icon } from '../Icon/Icon.tsx';
import type { IconName } from '../Icon/icons.ts';
import { strings } from './strings.ts';
import styles from './RecordChip.module.css';

/** Props for RecordChip. */
export interface RecordChipProps {
  /** The record or actor, as the data layer built it. */
  readonly display: RecordRefDisplay | ActorDisplay;
  /** The record's page, routed. Leave it out for a chip that only shows. */
  readonly href?: string;
  /** Grey with no edge, for dense places (board cards, the timeline). */
  readonly isFlat?: boolean;
}

const ACTOR_ICONS: Readonly<Record<'api_key' | 'automation' | 'system', IconName>> = {
  api_key: 'key',
  automation: 'zap',
  system: 'server',
};

function isRecord(display: RecordRefDisplay | ActorDisplay): display is RecordRefDisplay {
  return 'recordId' in display;
}

function Face({ display }: { readonly display: RecordRefDisplay | ActorDisplay }) {
  if (isRecord(display)) {
    return (
      <Avatar
        name={display.name}
        id={display.recordId}
        size="xs"
        shape={display.kind === 'person' ? 'circle' : 'square'}
        isDecorative
        {...(display.imageSrc === undefined ? {} : { src: display.imageSrc })}
        {...(display.hue === undefined ? {} : { hue: display.hue })}
      />
    );
  }
  if (display.type === 'member') {
    return (
      <Avatar
        name={display.name}
        id={display.id ?? display.name}
        size="xs"
        isDecorative
        {...(display.imageSrc === undefined ? {} : { src: display.imageSrc })}
        {...(display.hue === undefined ? {} : { hue: display.hue })}
      />
    );
  }
  return (
    <span className={styles.icon}>
      <Icon name={ACTOR_ICONS[display.type]} size="xs" />
    </span>
  );
}

/**
 * A linked record, a member, or another actor (an API key, an automation, the
 * system) as a chip with its avatar or icon. It is the one display for record
 * and actor references.
 */
export function RecordChip({ display, href, isFlat = false }: RecordChipProps) {
  const name = !isRecord(display) && display.type === 'system' ? strings.system : display.name;
  const content = (
    <>
      <Face display={display} />
      <span className={styles.label} data-truncated="">
        {name}
      </span>
    </>
  );
  const safe = safeHref(href);
  if (safe === undefined) {
    return (
      <span className={styles.root} data-flat={isFlat || undefined}>
        {content}
      </span>
    );
  }
  return (
    <AriaLink className={styles.root} href={safe} data-flat={isFlat || undefined}>
      {content}
    </AriaLink>
  );
}
