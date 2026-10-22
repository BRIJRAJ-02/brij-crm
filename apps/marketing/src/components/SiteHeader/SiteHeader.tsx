import { ButtonLink } from '@crm/ui';
import { LINKS } from '../../site.ts';
import { SiteLogo } from '../SiteLogo/SiteLogo.tsx';
import styles from './SiteHeader.module.css';

/** Every page's bar: the brand, and the two ways in (sign in, or start). */
export function SiteHeader() {
  return (
    <header className={styles.root}>
      <SiteLogo />
      <nav className={styles.nav} aria-label="Account">
        <ButtonLink href={LINKS.signIn} variant="ghost" size="lg">
          Sign in
        </ButtonLink>
        <ButtonLink href={LINKS.getStarted} variant="secondary" size="lg">
          Get started
        </ButtonLink>
      </nav>
    </header>
  );
}
