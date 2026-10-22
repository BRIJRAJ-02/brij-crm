import { ButtonLink } from '@crm/ui';
import { FEATURE_GROUPS } from '../../features.ts';
import { LINKS } from '../../site.ts';
import { AllFeatures } from '../AllFeatures/AllFeatures.tsx';
import { SiteLogo } from '../SiteLogo/SiteLogo.tsx';
import styles from './SiteFooter.module.css';

/** Props for SiteFooter. */
export interface SiteFooterProps {
  /** The year the copyright line names: the build's. */
  readonly year: number;
}

/** A column of the footer's links: its heading, then its rows. */
function Column({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  return (
    <div className={styles.column}>
      <h2 className={styles.heading}>{title}</h2>
      <ul className={styles.links}>{children}</ul>
    </div>
  );
}

/** One link in a column. */
function Row({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <li>
      <a className={styles.link} href={href}>
        {children}
      </a>
    </li>
  );
}

/**
 * Every page's footer: the brand with the way into the dashboard, then the product's areas (each opens in the live
 * demo), the ways in, and the legal pages; the copyright line under them.
 */
export function SiteFooter({ year }: SiteFooterProps) {
  return (
    <footer className={styles.root}>
      <div className={styles.top}>
        <div className={styles.brand}>
          <SiteLogo tone="dark" />
          <p className={styles.tagline}>Booking pages, forms and CRM in one place.</p>
          <ButtonLink href={LINKS.dashboard} variant="secondary" size="lg" iconRight="arrow-up-right">
            Open dashboard
          </ButtonLink>
        </div>
        <nav className={styles.columns} aria-label="Footer">
          <Column title="Product">
            {FEATURE_GROUPS.map((group) => (
              <Row key={group.id} href={`/#${group.id}`}>
                {group.title}
              </Row>
            ))}
            <li>
              <AllFeatures groups={FEATURE_GROUPS} />
            </li>
          </Column>
          <Column title="Get started">
            <Row href={LINKS.getStarted}>Claim your page</Row>
            <Row href={LINKS.signIn}>Sign in</Row>
            <Row href={LINKS.dashboard}>Open dashboard</Row>
          </Column>
          <Column title="Company">
            <Row href="/privacy">Privacy</Row>
            <Row href="/terms">Terms</Row>
          </Column>
        </nav>
      </div>
      <div className={styles.bottom}>
        <p className={styles.legal}>© {year} Timefix</p>
        <p className={styles.legal}>Book the meeting. Keep the customer.</p>
      </div>
    </footer>
  );
}
