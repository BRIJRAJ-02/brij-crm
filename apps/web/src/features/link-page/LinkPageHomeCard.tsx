// Brief
// Purpose: Home's "Your link page" card (spec 0051, AC-5121 to AC-5123): the QR code that opens the person's page.
// Main task: show the page to someone (scan the code, Copy link, Open), or save the code as a PNG to print. Every
// membership's page is made with it (26 Oct 2026) and stays private until its owner edits or shares it (27 Oct
// 2026): until then the card says Private, offers Make it public and a Preview only they can see, and draws no code
// to scan, since a code nobody else can open is a broken promise. The claim note is only for a page not made.
// Leaves out: editing the page (Edit opens the editor) and its figures (phase 3). Loaded with its own chunk, so
// neither it nor the QR library is in the app's first load.
import type { DataLayer, MyProfile } from '@crm/data';
import { Badge, Button, ButtonLink, Card, CopyButton, EmptyState, QrCode, Skeleton } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { publicProfileUrl } from '../booking/links.ts';
import { profileHref } from '../settings/nav.ts';
import { homeStrings as strings } from './home-strings.ts';
import { linkPageHref } from './nav-strings.ts';
import { showLinkPage } from './show.ts';
import { ShareLinkPageModal } from './ShareLinkPageModal.tsx';

/** Props for the card. */
export interface LinkPageHomeCardProps {
  readonly slug: string;
}

type Read =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly profile: MyProfile };

/** The person's profile, through the data layer: its handle decides what the card shows. */
function useProfile(data: DataLayer, slug: string) {
  const [read, setRead] = useState<Read>({ status: 'loading' });
  // Made public here: the profile read already held says private, and reading it again would only say what this knows.
  const [madePublic, setMadePublic] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isCurrent = true;
    data.profile.get(slug).then(
      (profile) => {
        if (isCurrent) setRead({ status: 'ready', profile });
      },
      () => {
        if (isCurrent) setRead({ status: 'error' });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, attempt]);
  return {
    read,
    isPublic: madePublic || (read.status === 'ready' && read.profile.isPublic !== false),
    madePublic: () => setMadePublic(true),
    retry: () => {
      setRead({ status: 'loading' });
      setAttempt((was) => was + 1);
    },
  };
}

/**
 * A link that saves the page to the person's wallet, or undefined (26 October 2026): this deployment has no
 * credentials for a wallet, the read failed, or they have no handle yet. Asked for once a visit, because a save
 * link is signed for a short while; a button nobody can use is never drawn, which is why this is read up front
 * rather than when it is pressed.
 */
function useWalletLink(data: DataLayer, slug: string): string | undefined {
  const [link, setLink] = useState<string | undefined>(undefined);
  useEffect(() => {
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
  }, [data, slug]);
  return link;
}

/** Your link page: its QR code, its address, Copy link, Open, and the code large in a Modal to save. */
export function LinkPageHomeCard({ slug }: LinkPageHomeCardProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { read, retry, isPublic, madePublic } = useProfile(data, slug);
  const [isShowing, setShowing] = useState(false);
  const [isPublishing, setPublishing] = useState(false);
  const wallet = useWalletLink(data, slug);
  if (read.status === 'loading') {
    return (
      <Card title={strings.title} isBusy>
        <Skeleton shape="block" width="full" />
      </Card>
    );
  }
  if (read.status === 'error') {
    return (
      <Card title={strings.title}>
        <EmptyState tone="error" layout="row" title={strings.failed} onRetry={retry} />
      </Card>
    );
  }
  const { handle } = read.profile;
  if (handle === undefined) {
    return (
      <Card title={strings.title}>
        <EmptyState
          layout="row"
          icon="link"
          title={strings.noHandle}
          actions={<ButtonLink href={profileHref(slug)}>{strings.goToProfile}</ButtonLink>}
        >
          {strings.noHandleText}
        </EmptyState>
      </Card>
    );
  }
  const address = publicProfileUrl(handle);
  const shown = address.replace(/^https?:\/\//, '');
  const workspace =
    read.profile.workspaceName === undefined ? {} : { description: strings.inWorkspace(read.profile.workspaceName) };
  if (!isPublic) {
    const publish = () => {
      setPublishing(true);
      showLinkPage(data, slug)
        .then((isNow) => {
          if (!isNow) throw new Error('No page to show.');
          madePublic();
          toasts.toast({ tone: 'success', message: strings.madePublic });
        })
        .catch(() => toasts.toast({ tone: 'danger', message: strings.makePublicFailed }))
        .finally(() => setPublishing(false));
    };
    return (
      <Card
        title={strings.title}
        {...workspace}
        actions={
          <>
            <Badge text={strings.private} dot="gray" />
            <ButtonLink variant="ghost" href={linkPageHref(slug)}>
              {strings.edit}
            </ButtonLink>
          </>
        }
      >
        <EmptyState
          layout="row"
          icon="lock"
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
          {strings.privateText(shown)}
        </EmptyState>
      </Card>
    );
  }
  return (
    <Card
      title={strings.title}
      {...workspace}
      actions={
        <>
          <Badge text={strings.live} dot="green" />
          <ButtonLink variant="ghost" href={linkPageHref(slug)}>
            {strings.edit}
          </ButtonLink>
        </>
      }
      footer={
        <>
          <CopyButton value={address} label={strings.copyLink} announcement={strings.copied} />
          <ButtonLink href={address} isExternal icon="arrow-up-right">
            {strings.open}
          </ButtonLink>
          <Button icon="qr-code" onPress={() => setShowing(true)}>
            {strings.showQr}
          </Button>
          {wallet !== undefined && (
            <ButtonLink href={wallet} isExternal icon="wallet">
              {strings.addToWallet}
            </ButtonLink>
          )}
        </>
      }
    >
      <QrCode value={address} label={strings.qrLabel} size="sm">
        <p>
          <strong>{shown}</strong>
        </p>
        <p>{strings.scan}</p>
      </QrCode>
      <ShareLinkPageModal
        address={address}
        handle={handle}
        workspaceName={read.profile.workspaceName}
        isOpen={isShowing}
        onClose={() => setShowing(false)}
      />
    </Card>
  );
}
