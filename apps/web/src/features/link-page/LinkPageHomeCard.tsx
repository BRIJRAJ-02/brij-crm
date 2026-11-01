// Brief
// Purpose: Home's "Your link page" card (spec 0051, AC-5121 to AC-5123): the QR code that opens the person's page.
// Main task: show the page to someone (scan the code, Copy link, Open); and the same Live or Private switch the
// link page screen has (spec 0058, AC-23), with one line saying what Private means.
// Leaves out: editing the page (Edit opens the editor) and its figures (phase 3). A page with no handle is claimed on
// the link page screen, never in Profile (AC-8). Loaded with its own chunk, so neither it nor the QR library is in
// the app's first load.
import type { DataLayer, MyProfile } from '@crm/data';
import { ButtonGroup, ButtonLink, Card, CopyButton, EmptyState, QrCode, Skeleton } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { publicProfileUrl } from '../booking/links.ts';
import { homeStrings as strings } from './home-strings.ts';
import { linkPageHref } from './nav-strings.ts';
import { LiveSwitch, useLinkPageLive, useWalletLink } from './private-page.tsx';

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
    retry: () => {
      setRead({ status: 'loading' });
      setAttempt((was) => was + 1);
    },
  };
}

/** Your link page: its QR code, its address, Copy link and Open. */
export function LinkPageHomeCard({ slug }: LinkPageHomeCardProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const { read, retry } = useProfile(data, slug);
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
    // Claimed on the link page screen, where the field is (spec 0058, AC-8): never a trip to Profile.
    return (
      <Card title={strings.title}>
        <EmptyState
          layout="row"
          icon="link"
          title={strings.noHandle}
          actions={<ButtonLink href={linkPageHref(slug)}>{strings.claim}</ButtonLink>}
        >
          {strings.noHandleText}
        </EmptyState>
      </Card>
    );
  }
  return <ReadyCard data={data} slug={slug} profile={read.profile} handle={handle} />;
}

/** The card once there is a page: the switch and Edit, then the code with its address, Copy link and Open. */
function ReadyCard({
  data,
  slug,
  profile,
  handle,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly profile: MyProfile;
  readonly handle: string;
}) {
  const live = useLinkPageLive(data, slug, profile.isPublic);
  const wallet = useWalletLink(data, slug, live.isLive);
  const address = publicProfileUrl(handle);
  const shown = address.replace(/^https?:\/\//, '');
  // One card, no footer strip: the code, its address and the two ways to hand it out sit together, Copy link the one
  // primary (the owner, 31 October 2026: Home items 6 to 10). A code explains itself, so no line says how to scan it,
  // and the code is already on show, so there is no Show QR code; the link page screen keeps Download and Share.
  return (
    <Card
      title={strings.title}
      // Which workspace's page the code opens, only for someone with a page in another workspace too (spec 0056,
      // AC-5617): with one workspace the line only said the title again (the owner, 31 October 2026, Home item 6).
      {...(profile.workspaceName === undefined || (profile.otherLinkPages?.length ?? 0) === 0
        ? {}
        : { description: strings.inWorkspace(profile.workspaceName) })}
      actions={
        <>
          <LiveSwitch live={live} />
          <ButtonLink variant="secondary" icon="pencil" href={linkPageHref(slug)}>
            {strings.edit}
          </ButtonLink>
        </>
      }
    >
      <QrCode value={address} label={strings.qrLabel} size="sm">
        <p>
          <strong>{shown}</strong>
        </p>
        {/* A private page says the one thing it can't do. */}
        {!live.isLive && <p>{strings.privateLine}</p>}
        <ButtonGroup label={strings.shareLabel} layout="row">
          {/* A private page's link opens for nobody, so Copy link is only the primary while it is Live. */}
          <CopyButton
            value={address}
            label={strings.copyLink}
            announcement={strings.copied}
            variant={live.isLive ? 'primary' : 'secondary'}
          />
          <ButtonLink href={address} isExternal icon="arrow-up-right">
            {strings.open}
          </ButtonLink>
          {wallet !== undefined && (
            <ButtonLink href={wallet} isExternal icon="wallet">
              {strings.addToWallet}
            </ButtonLink>
          )}
        </ButtonGroup>
      </QrCode>
    </Card>
  );
}
