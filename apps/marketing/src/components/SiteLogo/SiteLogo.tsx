import styles from './SiteLogo.module.css';

/** Props for SiteLogo. */
export interface SiteLogoProps {
  /** `dark` draws the white mark and wordmark, for the first fold (dark in every theme); `system` follows the reader's theme. */
  readonly tone: 'dark' | 'system';
}

/**
 * Timefix's mark and wordmark, linking to the top of the home page. The brand's own files (public/brand), the same
 * ones the app's sign in and booking pages draw.
 */
export function SiteLogo({ tone }: SiteLogoProps) {
  return (
    <a className={styles.root} href="/" aria-label="Timefix home">
      {tone === 'dark' ? (
        <>
          <img className={styles.mark} src="/brand/timefix-mark-on-dark.svg" alt="" width={32} height={32} />
          <img className={styles.wordmark} src="/brand/timefix-wordmark-dark.png" alt="" width={860} height={210} />
        </>
      ) : (
        <>
          <picture>
            <source srcSet="/brand/timefix-mark-on-dark.svg" media="(prefers-color-scheme: dark)" />
            <img className={styles.mark} src="/brand/timefix-mark.svg" alt="" width={32} height={32} />
          </picture>
          <picture>
            <source srcSet="/brand/timefix-wordmark-dark.png" media="(prefers-color-scheme: dark)" />
            <img className={styles.wordmark} src="/brand/timefix-wordmark-light.png" alt="" width={860} height={210} />
          </picture>
        </>
      )}
    </a>
  );
}
