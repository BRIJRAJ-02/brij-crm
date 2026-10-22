import { ButtonLink } from '@crm/ui';
import { LINKS, SAMPLE_BOOKING_ADDRESS } from '../../site.ts';
import { LiveDemo } from '../../live/LiveDemo.tsx';
import { SiteHeader } from '../SiteHeader/SiteHeader.tsx';
import styles from './FirstFold.module.css';

/**
 * The home page's first screen, exactly one screen tall: the bar, the promise, the one call to action (claim your
 * booking address), and the live demo, which takes whatever height is left.
 */
export function FirstFold() {
  return (
    <div className={styles.root}>
      <SiteHeader />
      <main className={styles.main} id="product">
        <div className={styles.hero}>
          <h1 className={styles.title}>
            <span className={styles.line} data-tone="quiet">
              Book the meeting.
            </span>{' '}
            <span className={styles.line}>Keep the customer.</span>
          </h1>
          <p className={styles.lead}>Booking pages, forms and CRM in one place. Every booking lands in your CRM.</p>
          <div className={styles.claim}>
            <span className={styles.address} aria-hidden="true">
              {SAMPLE_BOOKING_ADDRESS.host}/
              <span className={styles.handle}>{SAMPLE_BOOKING_ADDRESS.path.slice(1)}</span>
            </span>
            <ButtonLink
              href={LINKS.getStarted}
              variant="primary"
              size="xl"
              iconRight="arrow-right"
              label={`Claim your page at ${SAMPLE_BOOKING_ADDRESS.host}`}
            >
              Claim your page
            </ButtonLink>
          </div>
        </div>
        <div className={styles.demo}>
          <LiveDemo />
        </div>
      </main>
    </div>
  );
}
