// Brief
// Purpose: the person's several link pages in this workspace (spec 0064, AC-6413 to AC-6416): a switcher of tiles at
// the top of the Link page screen, each its page in miniature, and New link page at the end.
// Main task: open another page to share or edit it; make a new one (a handle and a name, then its Ready panel).
// Leaves out: everything a page holds (the screen under it edits the page picked), and any setting of a page beyond
// its private name, which page is the main one, and deleting it, all in one menu for the page on screen.
import { isDataError, type DataLayer, type LinkPageSummary } from '@crm/data';
import {
  Button,
  Card,
  Field,
  LinkPageThumbnail,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Modal,
  ReadyPanel,
  TileGrid,
  focusLater,
} from '@crm/ui';
import { handleProblem, HANDLE_MAX } from '@crm/contracts/handles';
import { LINK_PAGE_NAME_MAX, LINK_PAGES_MAX, linkPageNameProblem } from '@crm/contracts/link-page';
import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { addressAsTyped } from '../address/address.ts';
import { publicBookingHost, publicProfileUrl } from '../booking/links.ts';
import { pagesStrings as strings } from './pages-strings.ts';

/** Props for the switcher. */
export interface PageSwitcherProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The person's pages here, the main one first, as the route read them. */
  readonly pages: readonly LinkPageSummary[];
  /** The page the screen shows and edits. */
  readonly current: string;
  /** Opens another page (its address names it, so Back returns to the last). */
  readonly onPick: (id: string) => void;
  /** The list changed (made, renamed, made main, deleted): the route reads it and the profile again. */
  readonly onChanged: (open?: string) => void;
  /** A new page is ready and its Ready panel was left: the screen opens its editor, with Add ready. */
  readonly onStartEditing: () => void;
}

/** A page's tile name: its private name, else its address. */
const nameOf = (page: LinkPageSummary) => (page.name === '' ? strings.unnamed(page.handle) : page.name);

/** The switcher's tiles, the page menu, and the New link page, rename and delete dialogs. */
export function PageSwitcher({ data, slug, pages, current, onPick, onChanged, onStartEditing }: PageSwitcherProps) {
  const { toasts } = useRouteContext({ from: '__root__' });
  const [dialog, setDialog] = useState<'new' | 'rename' | 'delete' | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const shown = pages.find((page) => page.id === current) ?? pages[0];
  const isFull = pages.length >= LINK_PAGES_MAX;
  const fail = (error: unknown) => {
    setBusy(false);
    toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.failed });
  };
  const makePrimary = () => {
    if (shown === undefined || busy) return;
    setBusy(true);
    data.linkPage.pages.setPrimary(slug, shown.id).then(() => {
      setBusy(false);
      toasts.toast({ tone: 'success', message: strings.madePrimary });
      onChanged(shown.id);
    }, fail);
  };
  const remove = () => {
    if (shown === undefined || busy) return;
    setBusy(true);
    data.linkPage.pages.remove(slug, shown.id).then((left) => {
      setBusy(false);
      setDialog(undefined);
      toasts.toast({ tone: 'success', message: strings.deleted });
      // The main page opens in its place, and focus goes to its tile rather than falling to the page.
      onChanged(left.find((page) => page.isPrimary)?.id);
      focusLater(() => document.querySelector<HTMLElement>('[role="radiogroup"] input:checked'));
    }, fail);
  };
  return (
    <Card
      title={strings.switcher}
      {...(pages.length > 1 ? { description: strings.switcherText } : {})}
      {...(shown === undefined
        ? {}
        : {
            actions: (
              <MenuTrigger>
                <Button variant="ghost" icon="ellipsis" label={strings.options} isPending={busy} />
                <Menu label={strings.options}>
                  <MenuItem id="rename" icon="pencil" onAction={() => setDialog('rename')}>
                    {strings.rename}
                  </MenuItem>
                  {!shown.isPrimary && (
                    <MenuItem id="primary" icon="star" onAction={makePrimary}>
                      {strings.makePrimary}
                    </MenuItem>
                  )}
                  {/* The only page stays: there is always one to share (AC-6416). */}
                  {pages.length > 1 && (
                    <>
                      <MenuSeparator />
                      <MenuItem id="delete" icon="trash" isDanger onAction={() => setDialog('delete')}>
                        {strings.remove}
                      </MenuItem>
                    </>
                  )}
                </Menu>
              </MenuTrigger>
            ),
          })}
    >
      <TileGrid
        variant="choice"
        label={strings.switcher}
        value={shown?.id ?? null}
        tiles={pages.map((page) => ({
          id: page.id,
          name: nameOf(page),
          thumbnail: <LinkPageThumbnail theme={page.theme} />,
          // Its address, and which is the main page, read with the name and shown on hover.
          description: page.isPrimary
            ? `${strings.unnamed(page.handle)} · ${strings.primary}`
            : strings.unnamed(page.handle),
        }))}
        onChange={onPick}
        action={{
          tile: {
            id: 'new',
            name: strings.newPage,
            icon: 'plus',
            isDisabled: isFull,
            ...(isFull ? { disabledReason: strings.full, description: strings.fullReason } : {}),
          },
          onAction: () => setDialog('new'),
        }}
      />
      {dialog === 'new' && (
        <NewPageDialog
          data={data}
          slug={slug}
          onClose={() => setDialog(undefined)}
          onCreated={(id) => onChanged(id)}
          onDone={() => {
            setDialog(undefined);
            onStartEditing();
          }}
        />
      )}
      {dialog === 'rename' && shown !== undefined && (
        <RenameDialog
          data={data}
          slug={slug}
          page={shown}
          onClose={() => setDialog(undefined)}
          onRenamed={() => {
            setDialog(undefined);
            onChanged(shown.id);
          }}
        />
      )}
      {dialog === 'delete' && shown !== undefined && (
        <Modal
          title={strings.deleteTitle}
          variant="confirm"
          tone="danger"
          isOpen
          isBusy={busy}
          onOpenChange={(open) => {
            if (!open && !busy) setDialog(undefined);
          }}
          actions={
            <>
              <Button slot="close" isDisabled={busy}>
                {strings.cancel}
              </Button>
              <Button variant="danger-solid" icon="trash" isPending={busy} onPress={remove}>
                {strings.deleteAction}
              </Button>
            </>
          }
        >
          {strings.deleteText(`${publicBookingHost()}/${shown.handle}`)}
        </Modal>
      )}
    </Card>
  );
}

/**
 * New link page (AC-6414): only an address and a private name, then the 0058 Ready panel in the same Modal. The id is
 * minted once as it opens, so a retry makes one page.
 */
function NewPageDialog({
  data,
  slug,
  onClose,
  onCreated,
  onDone,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly onClose: () => void;
  /** The page exists: the screen opens it behind the Ready panel. */
  readonly onCreated: (id: string) => void;
  /** The Ready panel was left. */
  readonly onDone: () => void;
}) {
  const [id] = useState(() => data.linkPage.pages.newId());
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<{ readonly handle?: string; readonly name?: string; readonly form?: string }>(
    {},
  );
  const [isBusy, setBusy] = useState(false);
  const [made, setMade] = useState<string | undefined>(undefined);
  const create = () => {
    if (isBusy) return;
    const wanted = handle.trim();
    const found = {
      ...(wanted === '' ? { handle: strings.handleMissing } : {}),
      ...(wanted !== '' && handleProblem(wanted) !== undefined ? { handle: handleProblem(wanted) ?? '' } : {}),
      ...(linkPageNameProblem(name) === undefined ? {} : { name: linkPageNameProblem(name) ?? '' }),
    };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    data.linkPage.pages.create(slug, { id, handle: wanted, name: name.trim() }).then(
      () => {
        setBusy(false);
        setMade(wanted);
        onCreated(id);
        // Create page leaves with the form, so focus goes to the panel's first control, Copy link.
        focusLater(() => document.querySelector<HTMLElement>('[role="dialog"] section button'));
      },
      (error: unknown) => {
        setBusy(false);
        const field = isDataError(error) ? error.data?.refusals?.[0]?.field : undefined;
        const message = isDataError(error) ? error.message : strings.createFailed;
        setErrors(field === 'handle' ? { handle: message } : field === 'name' ? { name: message } : { form: message });
      },
    );
  };
  if (made !== undefined) {
    return (
      <Modal
        title={strings.readyTitle}
        isOpen
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        actions={<Button onPress={onDone}>{strings.readyEdit}</Button>}
      >
        <ReadyPanel message={strings.readyMessage} link={publicProfileUrl(made)} copyVariant="secondary" />
      </Modal>
    );
  }
  return (
    <Modal
      title={strings.newTitle}
      isOpen
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      {...(errors.form === undefined ? {} : { footerNote: errors.form })}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={create}>
            {isBusy ? strings.creating : strings.create}
          </Button>
        </>
      }
    >
      {strings.newText}
      <Field
        label={strings.handleLabel}
        name="handle"
        autoComplete="off"
        maxLength={HANDLE_MAX}
        prefix={`${publicBookingHost()}/`}
        value={handle}
        isReadOnly={isBusy}
        onChange={(next) => {
          setHandle(addressAsTyped(next));
          setErrors(({ handle: _gone, ...rest }) => rest);
        }}
        onSubmit={create}
        {...(errors.handle === undefined ? {} : { error: errors.handle })}
      />
      <Field
        label={strings.nameLabel}
        name="name"
        autoComplete="off"
        maxLength={LINK_PAGE_NAME_MAX}
        placeholder={strings.namePlaceholder}
        hint={strings.nameHint}
        value={name}
        isReadOnly={isBusy}
        onChange={(next) => {
          setName(next);
          setErrors(({ name: _gone, ...rest }) => rest);
        }}
        onSubmit={create}
        {...(errors.name === undefined ? {} : { error: errors.name })}
      />
    </Modal>
  );
}

/** Rename: the page's private name, one line of at most 40; empty goes back to its address. */
function RenameDialog({
  data,
  slug,
  page,
  onClose,
  onRenamed,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly page: LinkPageSummary;
  readonly onClose: () => void;
  readonly onRenamed: () => void;
}) {
  const [name, setName] = useState(page.name);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isBusy, setBusy] = useState(false);
  const save = () => {
    if (isBusy) return;
    const problem = linkPageNameProblem(name);
    if (problem !== undefined) {
      setError(problem);
      return;
    }
    setBusy(true);
    data.linkPage.pages.rename(slug, page.id, name.trim()).then(onRenamed, (failure: unknown) => {
      setBusy(false);
      setError(isDataError(failure) ? failure.message : strings.failed);
    });
  };
  return (
    <Modal
      title={strings.renameTitle}
      isOpen
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" isPending={isBusy} onPress={save}>
            {strings.save}
          </Button>
        </>
      }
    >
      <Field
        label={strings.nameLabel}
        name="name"
        autoComplete="off"
        maxLength={LINK_PAGE_NAME_MAX}
        placeholder={strings.unnamed(page.handle)}
        hint={strings.nameHint}
        value={name}
        isReadOnly={isBusy}
        onChange={(next) => {
          setName(next);
          setError(undefined);
        }}
        onSubmit={save}
        {...(error === undefined ? {} : { error })}
      />
    </Modal>
  );
}
