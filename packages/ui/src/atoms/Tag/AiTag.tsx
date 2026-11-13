import { Icon } from '../Icon/Icon.tsx';
import { VisuallyHidden } from '../VisuallyHidden/VisuallyHidden.tsx';
import { aiStrings as strings } from './ai-strings.ts';
import styles from './AiTag.module.css';
import { Tag } from './Tag.tsx';

/** Props for AiTag. */
export interface AiTagProps {
  /** The fact AI found ("AI enriched", "Series B"). */
  readonly children: string;
}

/**
 * A fact AI found, waiting to be trusted or edited (spec 0073, the prototype's AITag): Tag's chip on the surface with
 * a hairline, the violet sparkle before the words, said as "filled by AI" to screen readers. Tag's sibling in its own
 * file, so the screens that draw tags carry none of it until one shows an AI value.
 */
export function AiTag({ children }: AiTagProps) {
  return (
    <span className={styles.root}>
      <Tag>
        <Icon name="sparkles" size="xs" tone="ai" /> {children}
        <VisuallyHidden> {strings.filledByAi}</VisuallyHidden>
      </Tag>
    </span>
  );
}
