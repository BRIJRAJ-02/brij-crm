import styles from './SiteLogo.module.css';

/**
 * Timefix's mark and wordmark, linking to the top of the home page: the white pair, since every page is dark in
 * every theme (SiteFrame). The brand's own files (public/brand), the same ones the app's sign in and booking pages
 * draw.
 */
export function SiteLogo() {
  return (
    <a className={styles.root} href="/" aria-label="Timefix home">
      <img className={styles.mark} src="/brand/timefix-mark-on-dark.svg" alt="" width={32} height={32} />
      <img className={styles.wordmark} src="/brand/timefix-wordmark-dark.png" alt="" width={860} height={210} />
    </a>
  );
}
