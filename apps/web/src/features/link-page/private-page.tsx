// The two pieces a private link page needs wherever it is shown (Home's card and the page's own overview), so the
// wording, the publish and the wallet read never drift apart: `useWalletLink` and `PrivatePage`.
import type { DataLayer } from '@crm/data';
import { Button, ButtonLink, EmptyState } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { homeStrings as strings } from './home-strings.ts';
import { showLinkPage } from './show.ts';

/**
 * A link that saves the page to the person's wallet, or undefined (26 October 2026): this deployment has no
 * credentials for a wallet, the read failed, or the page isn't public, so a saved pass would open nothing. Asked
 * for once a visit, because the link is signed for a short while, and a button nobody can use is never drawn.
 */
export function useWalletLink(data: DataLayer, slug: string, isPublic: boolean): string | undefined {
  const [link, setLink] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!isPublic) return;
    let isCurrent = true;
    void data.linkPage.load().then(
      (store) =>
        store.walletLink(slug, 'apple_wallet').then(
          (answer) => {
            if (isCurrent && 'url' in answer) setLink(answer.url);
          },
          // No wallet is no error: the card simply doesn't offer it.
          () => undefined,
        ),
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, isPublic]);
  return link;
}

/** Props for PrivatePage. */
export interface PrivatePageProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The page's whole address: its owner previews it there, and the sentence names it. */
  readonly address: string;
  /** It went public here, so whatever holds the profile knows without reading it again. */
  readonly onPublic: () => void;
}

/**
 * A page made with a membership, before its owner has done anything with it (27 October 2026): why nobody else can
 * open it, the one press that changes that, and a preview only they can see.
 */
export function PrivatePage({ data, slug, address, onPublic }: PrivatePageProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [isPublishing, setPublishing] = useState(false);
  const publish = () => {
    setPublishing(true);
    showLinkPage(data, slug)
      .then((isNow) => {
        if (!isNow) throw new Error('No page to show.');
        onPublic();
        toasts.toast({ tone: 'success', message: strings.madePublic });
      })
      .catch(() => toasts.toast({ tone: 'danger', message: strings.makePublicFailed }))
      .finally(() => setPublishing(false));
  };
  return (
    <EmptyState
      tone="locked"
      layout="row"
      title={strings.privateTitle}
      actions={
        <>
          <Button variant="primary" isPending={isPublishing} onPress={publish}>
            {strings.makePublic}
          </Button>
          {/* Their own page as only they can see it: signed in, the public page answers its owner. */}
          <ButtonLink href={address} isExternal icon="arrow-up-right">
            {strings.preview}
          </ButtonLink>
        </>
      }
    >
      {strings.privateText(address.replace(/^https?:\/\//, ''))}
    </EmptyState>
  );
}
