import type { ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import styles from './AuthLayout.module.css';
import { strings } from './strings.ts';

/** The product's wordmark, one image per theme: dark ink for the light theme, white for the dark. */
export interface ProductLogo {
  /** The wordmark drawn on light surfaces. */
  readonly light: string;
  /** The wordmark drawn on dark surfaces. */
  readonly dark: string;
}

/** Props for AuthLayout. */
export interface AuthLayoutProps {
  /** The product's name, shown with its mark above the card (the wordmark's alt text when `logo` is given). */
  readonly productName: string;
  /** The product's wordmark, in place of the mark and name. The one shown follows the theme (a saved choice, else the OS). */
  readonly logo?: ProductLogo;
  /** The page's heading, its `h1`: "Sign in", "Check your email". */
  readonly title: string;
  /** A line under the heading. */
  readonly description?: string;
  /** The page's task: a SignInForm, a VerifyEmail, a Form. */
  readonly children: ReactNode;
  /** A footer under a hairline: a way back, or terms, or first run's Sign out. */
  readonly footer?: ReactNode;
  /**
   * Who is signed in, said at the start of the footer ("Signed in as
   * ada@acme.com"), before `footer` (first run, so a person sees which
   * account they are setting up, and can sign out of the wrong one).
   */
  readonly account?: string;
  /** A line above the title: where a flow stands (first run's Back and "Step 2 of 3"). */
  readonly eyebrow?: ReactNode;
  /**
   * A live preview beside the page's task (first run's WorkspacePreview): the
   * card splits in two from `bp-page-compact` up, and is the narrow card
   * below it. Decoration, hidden from assistive technology.
   */
  readonly preview?: ReactNode;
  /** While a Skeleton stands in for the page's task (the session is still being checked): marks the card busy, so assistive tech waits for it. */
  readonly isBusy?: boolean;
}

/**
 * The frame for the pages before the app: sign in, verify, first run. The
 * product's mark and name (or its wordmark), then the page card (`Card` with
 * `placement="page"` and `size="sm"`, the page's `main`, `size-panel` wide;
 * split in two with a `preview` from `bp-page-compact` up), centred across
 * the window. Down the window it sits a little above the middle on a wide
 * screen and near the top on a phone, at an offset that follows the window's
 * height and never the card's own, so it holds still between steps and as
 * its content grows. Kept `space-16` from each edge on a phone. `isBusy`
 * marks the card busy while a Skeleton stands in for its task.
 */
export function AuthLayout({
  productName,
  logo,
  title,
  description,
  children,
  footer,
  account,
  eyebrow,
  preview,
  isBusy = false,
}: AuthLayoutProps) {
  return (
    <div className={styles.root} data-split={preview === undefined ? undefined : ''}>
      <header className={styles.brand}>
        {logo === undefined ? (
          <>
            <Avatar name={productName} hue="ink" shape="square" size="md" isDecorative />
            <span className={styles.name}>{productName}</span>
          </>
        ) : (
          // Both are in the page; CSS shows the one for the theme, and the other is out of the accessibility tree.
          <>
            <img className={styles.logo} data-scheme="light" src={logo.light} alt={productName} />
            <img className={styles.logo} data-scheme="dark" src={logo.dark} alt={productName} />
          </>
        )}
      </header>
      <Card
        placement="page"
        size="sm"
        title={title}
        isBusy={isBusy}
        {...(description === undefined ? {} : { description })}
        {...(footer === undefined && account === undefined
          ? {}
          : {
              footer: (
                <>
                  {account !== undefined && <span className={styles.account}>{strings.signedInAs(account)}</span>}
                  {footer}
                </>
              ),
            })}
        {...(eyebrow === undefined ? {} : { eyebrow })}
        {...(preview === undefined ? {} : { preview })}
      >
        {children}
      </Card>
    </div>
  );
}
