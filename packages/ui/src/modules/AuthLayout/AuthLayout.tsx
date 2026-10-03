import type { ReactNode } from 'react';
import { Avatar } from '../../atoms/Avatar/Avatar.tsx';
import { Card } from '../../molecules/Card/Card.tsx';
import styles from './AuthLayout.module.css';

/** Props for AuthLayout. */
export interface AuthLayoutProps {
  /** The product's name, shown with its mark above the card. */
  readonly productName: string;
  /** The page's heading, its `h1`: "Sign in", "Check your email". */
  readonly title: string;
  /** A line under the heading. */
  readonly description?: string;
  /** The page's task: a SignInForm, a VerifyEmail, a Form. */
  readonly children: ReactNode;
  /** A footer under a hairline: a way back, or terms. */
  readonly footer?: ReactNode;
  /** While a Skeleton stands in for the page's task (the session is still being checked): marks the card busy, so assistive tech waits for it. */
  readonly isBusy?: boolean;
}

/**
 * The frame for the pages before the app: sign in, verify, the welcome
 * screen. The product's mark and name, then the page card (`Card` with
 * `placement="page"`, the page's `main`) centred in the window, kept
 * `space-16` from each edge on a phone. `isBusy` marks the card busy while a
 * Skeleton stands in for its task.
 */
export function AuthLayout({ productName, title, description, children, footer, isBusy = false }: AuthLayoutProps) {
  return (
    <div className={styles.root}>
      <header className={styles.brand}>
        <Avatar name={productName} hue="ink" shape="square" size="md" isDecorative />
        <span className={styles.name}>{productName}</span>
      </header>
      <Card
        placement="page"
        title={title}
        isBusy={isBusy}
        {...(description === undefined ? {} : { description })}
        {...(footer === undefined ? {} : { footer })}
      >
        {children}
      </Card>
    </div>
  );
}
