import type { ReactNode } from 'react';
import styles from './StoryRoot.module.css';

/**
 * The frame every story renders in, on the page surface with room around it,
 * so screenshots catch focus rings and shadows. Storybook only: its preview
 * wraps each story in one, and the screenshot tests capture it by test id.
 */
export function StoryRoot({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.root} data-testid="story-root">
      {children}
    </div>
  );
}
