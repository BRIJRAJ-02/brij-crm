// Brief
// Purpose: everyone's link page in one place (spec 0070, AC-7001), for owners, admins and holders of
// `link_pages.manage_team`: who has a page, whether it is Live, and how many looked this month.
// Main task: open someone's page to edit it, add a page for someone who never signs up, claim a handle for someone
// with none, hand a page only person their own page, or hand out QR codes (one, or all).
// Leaves out: inviting people (Members), what a page holds (its own editor) and Insights beyond this month's views.
import { isDataError, type DataLayer, type TeamLinkPage } from '@crm/data';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  Field,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  PageColumn,
  PersonLine,
  QrCode,
  sharedStrings,
  Table,
  TopBar,
  usePhoneWidth,
  VisuallyHidden,
  type TableColumn,
} from '@crm/ui';
import { handleProblem, HANDLE_MAX } from '@crm/contracts/handles';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { addressAsTyped } from '../address/address.ts';
import { publicBookingHost, publicProfileUrl } from '../booking/links.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { AddPageDialog } from './AddPageDialog.tsx';
import { CancelPageInvite, PageInviteDialog } from './PageInviteDialog.tsx';
import { useLinkPagePlace } from './place.tsx';
import { saveFile } from './qr-png.ts';
import { teamCodeFile, zipTeamCodes, type DrawnTeamCode } from './team-qr.ts';
import { teamStrings as strings } from './team-strings.ts';

/** Props for Team pages. */
export interface TeamPagesScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
}

/** What the list holds: read on each visit, since no change event carries anyone's page. */
type TeamState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly pages: readonly TeamLinkPage[] }
  | { readonly status: 'forbidden' }
  | { readonly status: 'failed'; readonly message: string };

/** A download under way: one page's code in one format, or every page's as one zip. */
type Drawing =
  | { readonly kind: 'one'; readonly handle: string; readonly format: 'png' | 'svg' }
  | { readonly kind: 'all'; readonly handles: readonly string[] };

const COLUMNS: readonly TableColumn[] = [
  { id: 'person', label: strings.columns.person, isRowHeader: true, phone: 'title' },
  { id: 'page', label: strings.columns.page },
  { id: 'status', label: strings.columns.status },
  { id: 'views', label: strings.columns.views, align: 'end' },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** The list of everyone's link pages, its QR downloads and the claim dialog. */
export function TeamPagesScreen({ data, slug }: TeamPagesScreenProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // The app's addresses, or the partner's frame's (spec 0070, AC-7032).
  const place = useLinkPagePlace(slug);
  const workspaceName = place.workspaceName ?? '';
  const [state, setState] = useState<TeamState>({ status: 'loading' });
  const [claiming, setClaiming] = useState<TeamLinkPage | undefined>(undefined);
  const [drawing, setDrawing] = useState<Drawing | undefined>(undefined);
  // Add a page, open (a new key for each opening, so it starts empty), and the page only person being removed.
  const [adding, setAdding] = useState<number | undefined>(undefined);
  const [removing, setRemoving] = useState<TeamLinkPage | undefined>(undefined);
  // A page only person being handed their page, and one whose open invitation is being cancelled.
  const [inviting, setInviting] = useState<TeamLinkPage | undefined>(undefined);
  const [uninviting, setUninviting] = useState<TeamLinkPage | undefined>(undefined);
  // Handing a page over lets someone in with a login, so it needs Members' invite permission too (the server checks);
  // the frame has no workspace access to read, so it is never drawn there (AC-7046).
  const canInvite = useCan('members.invite');
  // A connected app's person with no Timefix login yet: Set up their Timefix login, and their open invitation (spec
  // 0070, AC-7023). In Timefix only, with Members' invite permission too: never inside the app's frame, which never
  // reaches those calls (coordinator, 10 Nov 2026).
  const canSetUpLogin = (page: TeamLinkPage) =>
    !place.isEmbedded && canInvite && page.isFromApp === true && page.hasLogin !== true && !page.isSelf;
  /** One row put back in the list as the server answered it. */
  const replaceRow = (memberId: string, change: (page: TeamLinkPage) => TeamLinkPage) => {
    setState((was) =>
      was.status === 'ready'
        ? { status: 'ready', pages: was.pages.map((each) => (each.memberId === memberId ? change(each) : each)) }
        : was,
    );
  };
  // On a phone a row's figures sit on one line with no column heading over them, so the count says what it counts.
  const isPhone = usePhoneWidth();
  const read = useCallback(() => {
    let isCurrent = true;
    data.teamPages.list(slug).then(
      (list) => {
        if (isCurrent) setState({ status: 'ready', pages: list.pages });
      },
      (error: unknown) => {
        if (!isCurrent) return;
        if (isDataError(error) && error.code === 'FORBIDDEN') setState({ status: 'forbidden' });
        else setState({ status: 'failed', message: isDataError(error) ? error.message : strings.loadFailed });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);
  useEffect(read, [read]);

  const pages = state.status === 'ready' ? state.pages : [];
  const handles = pages.flatMap((page) => (page.handle === undefined ? [] : [page.handle]));

  /** A member's own page in the editor; your own row opens your own page, never the team one. */
  const openPage = (page: TeamLinkPage) => {
    if (page.isSelf) {
      void navigate({ href: place.href() });
      return;
    }
    if (page.handle === undefined) {
      setClaiming(page);
      return;
    }
    void navigate({ href: place.href({ member: page.memberId }) });
  };

  const copy = (handle: string) => {
    navigator.clipboard.writeText(publicProfileUrl(handle)).then(
      () => toasts.toast({ tone: 'success', message: strings.copied }),
      () => toasts.toast({ tone: 'danger', message: strings.copyFailed }),
    );
  };

  const menuOf = (page: TeamLinkPage) => (
    <MenuTrigger>
      <Button variant="ghost" icon="ellipsis" label={strings.rowActions(page.name)} />
      <Menu
        label={strings.rowActions(page.name)}
        onAction={(key) => {
          if (key === 'edit' || key === 'claim') openPage(page);
          if (key === 'remove') setRemoving(page);
          if (key === 'invite' || key === 'login') setInviting(page);
          if (key === 'uninvite' || key === 'unlogin') setUninviting(page);
          if (page.handle === undefined) return;
          if (key === 'copy') copy(page.handle);
          // One download at a time: a second press while one is drawn waits for it rather than being lost.
          if ((key === 'png' || key === 'svg') && drawing === undefined) {
            setDrawing({ kind: 'one', handle: page.handle, format: key });
          }
        }}
      >
        {page.handle === undefined ? (
          <MenuItem id="claim" icon="at-sign">
            {strings.claim}
          </MenuItem>
        ) : (
          <>
            <MenuItem id="edit" icon="pencil">
              {strings.edit}
            </MenuItem>
            <MenuItem id="copy" icon="copy">
              {strings.copyLink}
            </MenuItem>
            <MenuItem id="open" icon="external-link" href={publicProfileUrl(page.handle)} isExternal>
              {strings.openPage}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="png" icon="qr-code" isDisabled={drawing !== undefined}>
              {strings.qrPng}
            </MenuItem>
            <MenuItem id="svg" icon="qr-code" isDisabled={drawing !== undefined}>
              {strings.qrSvg}
            </MenuItem>
          </>
        )}
        {page.isPageOnly === true && (
          <>
            <MenuSeparator />
            {canInvite &&
              (page.invite === undefined ? (
                <MenuItem id="invite" icon="mail">
                  {strings.invitePerson}
                </MenuItem>
              ) : (
                <>
                  <MenuItem id="invite" icon="send">
                    {strings.resendInvite}
                  </MenuItem>
                  <MenuItem id="uninvite" icon="x" isDanger>
                    {strings.revokeInvite}
                  </MenuItem>
                </>
              ))}
            <MenuItem id="remove" icon="user-x" isDanger>
              {strings.removePerson}
            </MenuItem>
          </>
        )}
        {canSetUpLogin(page) && (
          <>
            <MenuSeparator />
            {page.invite === undefined ? (
              <MenuItem id="login" icon="key">
                {strings.loginInvite}
              </MenuItem>
            ) : (
              <>
                <MenuItem id="login" icon="send">
                  {strings.resendInvite}
                </MenuItem>
                <MenuItem id="unlogin" icon="x" isDanger>
                  {strings.revokeInvite}
                </MenuItem>
              </>
            )}
          </>
        )}
      </Menu>
    </MenuTrigger>
  );

  const cell = (page: TeamLinkPage, column: string): ReactNode => {
    switch (column) {
      case 'person':
        return (
          <PersonLine
            id={page.memberId}
            name={page.name}
            meta={[
              ...(page.isSelf ? [strings.you] : []),
              ...(page.isPageOnly === true ? [strings.pageOnly] : []),
              ...(page.invite === undefined
                ? []
                : [page.invite.isExpired === true ? strings.inviteExpired : strings.invited]),
            ]}
            {...(page.image === undefined ? {} : { src: page.image })}
          />
        );
      case 'page':
        return page.handle === undefined ? strings.noPage : `/${page.handle}`;
      case 'status':
        if (page.handle === undefined) return null;
        return page.isLive ? (
          <Badge text={strings.live} dot="green" isWhole />
        ) : (
          <Badge text={strings.private} dot="gray" isWhole />
        );
      case 'views':
        if (page.handle === undefined) return null;
        return isPhone ? strings.viewsCounted(page.views) : strings.views(page.views);
      default:
        return menuOf(page);
    }
  };

  const body = (() => {
    if (state.status === 'forbidden') {
      return (
        <EmptyState icon="lock" title={strings.forbiddenTitle} layout="block">
          {strings.forbidden}
        </EmptyState>
      );
    }
    if (state.status === 'failed') {
      return (
        <EmptyState
          icon="triangle-alert"
          title={strings.loadFailed}
          layout="block"
          actions={
            <Button
              onPress={() => {
                setState({ status: 'loading' });
                read();
              }}
            >
              {strings.retry}
            </Button>
          }
        >
          {state.message}
        </EmptyState>
      );
    }
    return (
      <Table
        label={strings.table}
        columns={COLUMNS}
        rows={pages}
        getRowId={(page) => page.memberId}
        renderCell={cell}
        isLoading={state.status === 'loading'}
        onRowAction={(id) => {
          const page = pages.find((each) => each.memberId === id);
          if (page !== undefined) openPage(page);
        }}
        phoneLayout="rows"
        emptyState={
          <EmptyState
            icon="users"
            title={strings.empty}
            actions={
              <Button variant="primary" icon="user-plus" onPress={() => setAdding((was) => (was ?? 0) + 1)}>
                {strings.addPage}
              </Button>
            }
          >
            {strings.emptyText}
          </EmptyState>
        }
      />
    );
  })();

  return (
    <WorkspacePage
      currentPage="linkPage"
      page={{
        topBar: (
          <TopBar
            title={strings.title}
            icon="users"
            crumbs={[{ id: 'link-page', label: strings.linkPage, href: place.href() }]}
            back={{ label: strings.linkPage, href: place.href() }}
          >
            {state.status !== 'forbidden' && (
              // There from the first paint, off until the list is in, so the bar never shifts.
              <Button
                icon="download"
                isLabelCollapsible
                label={strings.downloadAll}
                isDisabled={state.status !== 'ready' || handles.length === 0 || drawing?.kind === 'one'}
                isPending={drawing?.kind === 'all'}
                onPress={() => setDrawing({ kind: 'all', handles })}
              >
                {strings.downloadAll}
              </Button>
            )}
            {state.status !== 'forbidden' && (
              // A page for someone who never signs up (9 Nov 2026): only people who may manage the team's pages get
              // this far, and the server checks again.
              <Button
                variant="primary"
                icon="user-plus"
                isLabelCollapsible
                label={strings.addPage}
                isDisabled={state.status !== 'ready'}
                onPress={() => setAdding((was) => (was ?? 0) + 1)}
              >
                {strings.addPage}
              </Button>
            )}
          </TopBar>
        ),
        body: (
          <PageColumn>
            {body}
            {claiming !== undefined && (
              <ClaimForMember
                data={data}
                slug={slug}
                page={claiming}
                onClose={() => setClaiming(undefined)}
                onClaimed={(claimed) => {
                  setClaiming(undefined);
                  setState((was) =>
                    was.status === 'ready'
                      ? {
                          status: 'ready',
                          pages: was.pages.map((each) => (each.memberId === claimed.memberId ? claimed : each)),
                        }
                      : was,
                  );
                  if (claimed.handle !== undefined) {
                    toasts.toast({ tone: 'success', message: strings.claimed(claimed.handle, claimed.name) });
                  }
                }}
              />
            )}
            {adding !== undefined && (
              <AddPageDialog
                key={adding}
                data={data}
                slug={slug}
                isOpen
                onClose={() => setAdding(undefined)}
                onAdded={(added) => {
                  setAdding(undefined);
                  setState((was) =>
                    was.status === 'ready'
                      ? {
                          status: 'ready',
                          pages: [...was.pages.filter((each) => each.memberId !== added.memberId), added].sort(
                            (a, b) => a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId),
                          ),
                        }
                      : was,
                  );
                  toasts.toast({
                    tone: 'success',
                    message: strings.added(added.handle ?? '', added.name),
                    action: {
                      label: strings.edit,
                      onAction: () => void navigate({ href: place.href({ member: added.memberId }) }),
                    },
                  });
                }}
              />
            )}
            <RemovePerson
              data={data}
              slug={slug}
              page={removing}
              onClose={() => setRemoving(undefined)}
              onRemoved={(gone) => {
                setRemoving(undefined);
                setState((was) =>
                  was.status === 'ready'
                    ? { status: 'ready', pages: was.pages.filter((each) => each.memberId !== gone.memberId) }
                    : was,
                );
                toasts.toast({ tone: 'success', message: strings.removed(gone.name) });
              }}
            />
            {inviting !== undefined && (
              <PageInviteDialog
                key={inviting.memberId}
                data={data}
                slug={slug}
                page={inviting}
                {...(inviting.isFromApp === true ? { kind: { kind: 'login' } } : {})}
                onClose={() => setInviting(undefined)}
                onSent={(invite, sent) => {
                  const sentFor = { ...inviting, invite };
                  setInviting(undefined);
                  replaceRow(inviting.memberId, () => sentFor);
                  toasts.toast(
                    sent
                      ? { tone: 'success', message: strings.inviteSent(invite.email) }
                      : {
                          tone: 'danger',
                          message: strings.inviteUnsent,
                          action: { label: strings.resendInvite, onAction: () => setInviting(sentFor) },
                        },
                  );
                }}
              />
            )}
            <CancelPageInvite
              data={data}
              slug={slug}
              page={uninviting}
              {...(uninviting?.isFromApp === true ? { kind: 'login' as const } : {})}
              onClose={() => setUninviting(undefined)}
              onCancelled={(page) => {
                setUninviting(undefined);
                replaceRow(page.memberId, ({ invite: _gone, ...rest }) => rest);
                toasts.toast({ tone: 'success', message: strings.inviteRevoked(page.invite?.email ?? '') });
              }}
            />
            {drawing !== undefined && (
              <DrawCodes
                drawing={drawing}
                zipName={strings.zipName(workspaceName || slug)}
                onDone={(failed, count) => {
                  setDrawing(undefined);
                  if (failed) {
                    toasts.toast({
                      tone: 'danger',
                      message: drawing.kind === 'all' ? strings.zipFailed : strings.qrFailed,
                    });
                  } else if (drawing.kind === 'all') {
                    toasts.toast({ tone: 'success', message: strings.zipped(count) });
                  }
                }}
              />
            )}
          </PageColumn>
        ),
      }}
    />
  );
}

/**
 * The codes a download needs, drawn out of sight by the library's QrCode (the plain code: dark on light, the page's
 * address only), then saved: one file, or every one in a zip. Unmounts itself through `onDone`.
 */
function DrawCodes({
  drawing,
  zipName,
  onDone,
}: {
  readonly drawing: Drawing;
  readonly zipName: string;
  readonly onDone: (failed: boolean, count: number) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const handles = drawing.kind === 'all' ? drawing.handles : [drawing.handle];
  useEffect(() => {
    let cancelled = false;
    const drawn: DrawnTeamCode[] = handles.flatMap((handle) => {
      const svg = holder.current?.querySelector<SVGSVGElement>(`svg[aria-label="${CSS.escape(handle)}"]`);
      return svg === null || svg === undefined ? [] : [{ handle, svg }];
    });
    const work =
      drawing.kind === 'all'
        ? zipTeamCodes(drawn).then((zip) => saveFile(zip, zipName))
        : drawn[0] === undefined
          ? Promise.reject(new Error('No code was drawn.'))
          : teamCodeFile(drawn[0], drawing.format).then((file) => saveFile(file.blob, file.name));
    work.then(
      () => {
        if (!cancelled) done.current(false, drawn.length);
      },
      () => {
        if (!cancelled) done.current(true, 0);
      },
    );
    return () => {
      cancelled = true;
    };
    // Drawn once: a new download is a new mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, by design
  }, []);
  return (
    <VisuallyHidden>
      <div ref={holder} aria-hidden="true">
        {handles.map((handle) => (
          <QrCode key={handle} value={publicProfileUrl(handle)} label={handle} />
        ))}
      </div>
    </VisuallyHidden>
  );
}

/**
 * Claim a handle for someone with no page (AC-7002): the address after the public host, checked by the contract's
 * rule before anything is sent; the server's refusal (a taken handle) lands on the field. The page starts Private.
 */
function ClaimForMember({
  data,
  slug,
  page,
  onClose,
  onClaimed,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: TeamLinkPage;
  readonly onClose: () => void;
  readonly onClaimed: (claimed: TeamLinkPage) => void;
}) {
  // A link made from their name to start from, as their own first claim suggests one: the server still says if it's taken.
  const [handle, setHandle] = useState(() => addressAsTyped(page.name.trim().toLowerCase().replace(/\s+/g, '-')));
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isClaiming, setIsClaiming] = useState(false);
  const claim = () => {
    if (isClaiming) return;
    const wanted = handle.trim();
    const wrong = wanted === '' ? strings.handleMissing : handleProblem(wanted);
    if (wrong !== undefined) {
      setProblem(wrong);
      return;
    }
    setIsClaiming(true);
    setProblem(undefined);
    data.teamPages.claim(slug, page.memberId, wanted).then(onClaimed, (error: unknown) => {
      setIsClaiming(false);
      setProblem(isDataError(error) ? error.message : strings.claimFailed);
    });
  };
  return (
    <Modal
      title={strings.claimTitle(page.name)}
      description={strings.claimText}
      isOpen
      isBusy={isClaiming}
      onOpenChange={(open) => {
        if (!open && !isClaiming) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isClaiming}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isClaiming} onPress={claim}>
            {isClaiming ? strings.claiming : strings.claimAction}
          </Button>
        </>
      }
    >
      <Field
        label={strings.handleLabel}
        name="handle"
        autoComplete="off"
        maxLength={HANDLE_MAX}
        prefix={`${publicBookingHost()}/`}
        value={handle}
        isReadOnly={isClaiming}
        onChange={(next) => {
          setHandle(addressAsTyped(next));
          setProblem(undefined);
        }}
        onSubmit={claim}
        {...(problem === undefined ? {} : { error: problem })}
      />
    </Modal>
  );
}

/**
 * Asks before a page only person is removed (the owner: anything that ends something asks first): a danger Modal that
 * says the link stops and the content stays 30 days, busy while the server works, its refusal inside. The last person
 * asked about stays while the Modal plays its exit.
 */
function RemovePerson({
  data,
  slug,
  page,
  onClose,
  onRemoved,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: TeamLinkPage | undefined;
  readonly onClose: () => void;
  readonly onRemoved: (gone: TeamLinkPage) => void;
}) {
  const [last, setLast] = useState(page);
  if (page !== undefined && page !== last) setLast(page);
  const [isBusy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const shown = page ?? last;
  if (shown === undefined) return null;
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setFailure(undefined);
    data.teamPages.removePerson(slug, shown.memberId).then(
      () => {
        setBusy(false);
        onRemoved(shown);
      },
      (error: unknown) => {
        setBusy(false);
        setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
      },
    );
  };
  return (
    <Modal
      title={strings.removeTitle(shown.name)}
      variant="confirm"
      tone="danger"
      isOpen={page !== undefined}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) {
          setFailure(undefined);
          onClose();
        }
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="danger-solid" isPending={isBusy} onPress={remove}>
            {strings.removeAction}
          </Button>
        </>
      }
    >
      {failure !== undefined && <Callout tone="danger">{failure}</Callout>}
      {strings.removeText(shown.handle)}
    </Modal>
  );
}

/**
 * A member's page that can't be opened from Team pages (spec 0070): they left, the address is stale, or it isn't the
 * reader's to change (an owner's page, or no permission). One line and the way back to Team pages, never Home.
 */
export function MemberPageUnavailable({ slug }: { readonly slug: string }) {
  const place = useLinkPagePlace(slug);
  const teamHref = place.href({ team: true });
  return (
    <WorkspacePage
      currentPage="linkPage"
      page={{
        topBar: (
          <TopBar
            title={strings.unavailable}
            icon="id-card"
            crumbs={[
              { id: 'link-page', label: strings.linkPage, href: place.href() },
              { id: 'team', label: strings.title, href: teamHref },
            ]}
            back={{ label: strings.back, href: teamHref }}
          />
        ),
        body: (
          <PageColumn align="center">
            <EmptyState
              icon="lock"
              title={strings.unavailable}
              layout="block"
              actions={<ButtonLink href={teamHref}>{strings.back}</ButtonLink>}
            >
              {strings.unavailableText}
            </EmptyState>
          </PageColumn>
        ),
      }}
    />
  );
}
