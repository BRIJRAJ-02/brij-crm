// The business page's call to action (spec 0066, AC-6642): Reserve a table. Open, it is a link to the reservation flow
// at `/<handle>/reserve`; until that flow lands it is a disabled button that says "Coming soon", with a line saying how
// to book meanwhile, so a guest is never left at a dead end.
import { Button, ButtonLink } from '../../atoms/Button/Button.tsx';
import styles from './BusinessReserve.module.css';
import { strings } from './strings.ts';

/** Props for BusinessReserve. */
export interface BusinessReserveProps {
  /** `open` with the flow's address, or `soon` until it lands. */
  readonly state: { readonly kind: 'open'; readonly href: string } | { readonly kind: 'soon' };
  /** Whether the line under a Coming soon button shows (the side panel has room; the phone's bar doesn't). */
  readonly showsNote?: boolean;
}

/** Reserve a table, full width, a thumb's height. */
export function BusinessReserve({ state, showsNote = true }: BusinessReserveProps) {
  if (state.kind === 'open') {
    return (
      <ButtonLink variant="primary" size="touch" icon="calendar-clock" href={state.href} isFullWidth="center">
        {strings.reserve}
      </ButtonLink>
    );
  }
  return (
    <div className={styles.root}>
      <div className={styles.soon}>
        <Button variant="primary" size="touch" icon="calendar-clock" isFullWidth="center" isDisabled>
          {strings.reserve}
        </Button>
        <span className={styles.badge}>{strings.comingSoon}</span>
      </div>
      {showsNote && <p className={styles.note}>{strings.reserveSoon}</p>}
    </div>
  );
}
