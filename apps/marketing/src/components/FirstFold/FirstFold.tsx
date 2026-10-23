import { ButtonLink } from '@crm/ui';
import { LINKS, SAMPLE_BOOKING_ADDRESS } from '../../site.ts';
import { Backdrop } from '../Backdrop/Backdrop.tsx';
import { Showcase } from '../Showcase/Showcase.tsx';
import { SiteHeader } from '../SiteHeader/SiteHeader.tsx';
import styles from './FirstFold.module.css';

/**
 * The home page's first screen, at least one screen tall: the bar, the promise, the one call to action (claim your
 * booking address), and the showcase (the product's areas as tabs, each with its screens), at the content's full width.
 */
export function FirstFold() {
  return (
    <div className={styles.root}>
      <SiteHeader />
      <main className={styles.main}>
        <Backdrop side="start" />
        <Backdrop side="end" />
        <div className={styles.hero}>
          <h1 className={styles.title}>
            <span className={styles.line} data-tone="quiet">
              Book the meeting.
            </span>{' '}
            <span className={styles.line}>Keep the customer.</span>
          </h1>
          <p className={styles.lead}>
            Booking pages, forms and CRM in one place. Every booking becomes a customer record.
          </p>
          <div className={styles.claim}>
            <span className={styles.address} aria-hidden="true">
              {SAMPLE_BOOKING_ADDRESS.host}/
              <span className={styles.handle}>{SAMPLE_BOOKING_ADDRESS.path.slice(1)}</span>
            </span>
            <ButtonLink
              href={LINKS.getStarted}
              variant="primary"
              size="lg"
              iconRight="arrow-right"
              label={`Claim your page at ${SAMPLE_BOOKING_ADDRESS.host}`}
            >
              Claim your page
            </ButtonLink>
          </div>
        </div>
        <div className={styles.demo}>
          <Showcase />
        </div>
      </main>
    </div>
  );
}
