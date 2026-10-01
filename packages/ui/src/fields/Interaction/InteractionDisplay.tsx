import type { ActorDisplay, InteractionValue } from '@crm/contracts/values';
import { Icon } from '../../atoms/Icon/Icon.tsx';
import { RelativeTime } from '../../atoms/RelativeTime/RelativeTime.tsx';
import { actorDisplayOf } from '../ActorReference/ActorReferenceDisplay.tsx';
import { EmptyValue } from '../parts.tsx';
import type { DisplayProps } from '../types.ts';
import { asList } from '../values.ts';
import styles from './InteractionDisplay.module.css';
import { strings } from './strings.ts';

/** Interaction: a mail or calendar icon, when ("3 hours ago"), and who. */
export function InteractionDisplay({ value, display, surface }: DisplayProps<'interaction'>) {
  if (value === null || Array.isArray(value)) return <EmptyValue surface={surface} />;
  const interaction = value as InteractionValue;
  const by = actorDisplayOf(interaction.by, asList<ActorDisplay>(display));
  return (
    <span className={styles.root}>
      <Icon
        name={interaction.kind === 'email' ? 'mail' : 'calendar'}
        size="sm"
        tone="muted"
        label={strings[interaction.kind]}
      />
      <RelativeTime value={interaction.at} />
      <span className={styles.by}>{strings.by(by.name)}</span>
    </span>
  );
}
