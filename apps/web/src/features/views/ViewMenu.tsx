// Brief
// Purpose: everything you can do to the view you're on (spec 0020, AC-473 to AC-477, AC-490), under "This view" in
// the view switcher's menu (it was a "···" button of its own until the view bar was simplified, 21 October 2026).
// Main task: pick an action; one you could take after a change is there, disabled, saying why; one that can never
// apply here is left out.
// Leaves out: the view's columns (View settings) and its filters and sorts (the Toolbar).
import {
  isDataError,
  viewRule,
  type MemberSummary,
  type ObjectSummary,
  type View,
  type ViewAction,
  type ViewRuleReason,
  type ViewsListSnapshot,
} from '@crm/data';
import { Button, Callout, Field, Form, Modal, type FormRefusal, type ViewAction as ViewMenuAction } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useId, useState, type ReactNode } from 'react';
import { strings } from './strings.ts';

/** Props for the view's actions. */
export interface ViewMenuProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The view open; undefined while it loads (nothing to act on yet). */
  readonly view: View | undefined;
  readonly list: ViewsListSnapshot;
  /** The workspace's active members: names, and whether a creator is still here. */
  readonly members: readonly MemberSummary[];
  readonly memberId: string | undefined;
  readonly canManage: boolean;
  /** Why Copy link can't copy this address (a draft too long for a link), or undefined when it can. */
  readonly copyLinkReason: string | undefined;
  /** Duplicate: the screen makes the copy and opens it. */
  readonly onDuplicate: () => void;
  /** A delete here starts (true) or was refused (false): the screen expects the view to go. */
  readonly onDeleting: (isDeleting: boolean) => void;
  /** The view was deleted here: the screen goes to the default view. */
  readonly onDeleted: (name: string) => void;
}

/** A member's name, "A removed member" when they left, "the workspace" for a view nobody made. */
export function memberName(members: readonly MemberSummary[], memberId: string | undefined): string {
  if (memberId === undefined) return strings.theWorkspace;
  return members.find((member) => member.id === memberId)?.name ?? strings.removedMember;
}

/** What the switcher's "This view" section holds, what runs each action, and the dialogs they open. */
export interface ViewMenu {
  readonly actions: readonly ViewMenuAction[];
  readonly onAction: (id: string) => void;
  /** The Rename dialog and the Delete confirm, drawn by the screen beside the bar. */
  readonly dialogs: ReactNode;
}

/**
 * Reasons that mean an action can never apply to this view (the default view moving, the workspace's own view
 * going private, nothing to do): the action is left out of the menu, not shown disabled (the owner, 21 October
 * 2026). An action the person could take after a change (Delete once another view is the default) stays,
 * disabled, with its short reason.
 */
const NEVER: ReadonlySet<ViewRuleReason> = new Set<ViewRuleReason>(['defaultFirst', 'seeded', 'manage', 'already']);

/**
 * The view's own actions for the switcher's menu (it was the "More view actions" button), its Rename dialog
 * and its Delete confirm.
 */
export function useViewMenu({
  slug,
  object,
  view,
  list,
  members,
  memberId,
  canManage,
  copyLinkReason,
  onDuplicate,
  onDeleting,
  onDeleted,
}: ViewMenuProps): ViewMenu {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [isRenaming, setRenaming] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<string | undefined>(undefined);
  if (view === undefined) return { actions: [], onAction: () => undefined, dialogs: null };
  const caller = {
    memberId,
    canManage,
    isActiveMember: (id: string) => members.some((member) => member.id === id),
  };
  const facts = {
    visibility: view.visibility,
    creatorMemberId: view.creatorMemberId,
    isLocked: view.isLocked,
    isDefault: list.defaultViewId === view.id,
  };
  // An action's reason, or `null` when it can never apply here and is left out.
  const reasonFor = (action: ViewAction): string | undefined | null => {
    const reason: ViewRuleReason | undefined = viewRule(action, caller, facts);
    if (reason === undefined) return undefined;
    if (NEVER.has(reason)) return null;
    switch (reason) {
      case 'locked':
        return strings.viewLocked;
      // Only someone who may choose the default can act on "make another view the default first"; and the
      // workspace's own view (no creator) stays shared whatever the default is.
      case 'default':
        return canManage && !(action === 'makePrivate' && view.creatorMemberId === undefined)
          ? strings.defaultFirstFix
          : null;
      case 'creatorGone':
        return strings.creatorGone;
      case 'notCreator':
        return strings.onlyCreator(memberName(members, view.creatorMemberId));
      case 'unlockFirst':
        return strings.unlockFirst;
      case 'private':
        return strings.shareFirst;
      default:
        return null;
    }
  };
  // Move up and down within its group (the shared views after the default, or this person's private ones), only
  // where the view can go that way now.
  const group = list.views.filter((each) => each.visibility === view.visibility && each.id !== list.defaultViewId);
  const at = group.findIndex((each) => each.id === view.id);
  const canMove = (direction: 'up' | 'down') =>
    reasonFor('move') === undefined && at !== -1 && (direction === 'up' ? at > 0 : at < group.length - 1);

  const run = (work: Promise<unknown>, done?: string) => {
    work.then(
      () => {
        if (done !== undefined) toasts.toast({ tone: 'success', message: done });
      },
      (error: unknown) => {
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.actionFailed });
      },
    );
  };

  type Entry = ViewMenuAction & { readonly run: () => void };
  /** An entry, or nothing when its action can never apply here. */
  const entry = (reason: string | undefined | null, rest: Omit<Entry, 'reason'>): readonly Entry[] =>
    reason === null ? [] : [{ ...rest, ...(reason === undefined ? {} : { reason }) }];
  const sharing =
    view.visibility === 'private'
      ? entry(reasonFor('share'), {
          id: 'share',
          label: strings.shareWithEveryone,
          icon: 'users',
          startsGroup: true,
          run: () => {
            run(data.views.update(slug, view.id, { visibility: 'workspace' }), strings.shared(view.name));
          },
        })
      : entry(reasonFor('makePrivate'), {
          id: 'make-private',
          label: strings.makePrivate,
          icon: 'lock',
          startsGroup: true,
          run: () => {
            run(data.views.update(slug, view.id, { visibility: 'private' }), strings.madePrivate(view.name));
          },
        });
  const entries: readonly Entry[] = [
    ...entry(reasonFor('edit'), { id: 'rename', label: strings.rename, icon: 'pencil', run: () => setRenaming(true) }),
    { id: 'duplicate', label: strings.duplicate, icon: 'copy', run: onDuplicate },
    ...entry(copyLinkReason, {
      id: 'copy-link',
      label: strings.copyLink,
      icon: 'link',
      run: () => {
        navigator.clipboard.writeText(window.location.href).then(
          () => {
            toasts.toast({ tone: 'success', message: strings.linkCopied });
          },
          () => {
            toasts.toast({ tone: 'danger', message: strings.copyFailed });
          },
        );
      },
    }),
    ...(canMove('up')
      ? [
          {
            id: 'move-up',
            label: strings.moveUp,
            icon: 'arrow-up' as const,
            startsGroup: true,
            run: () => {
              run(data.views.move(slug, object.id, view.id, 'up'), strings.movedUp(view.name));
            },
          },
        ]
      : []),
    ...(canMove('down')
      ? [
          {
            id: 'move-down',
            label: strings.moveDown,
            icon: 'arrow-down' as const,
            startsGroup: !canMove('up'),
            run: () => {
              run(data.views.move(slug, object.id, view.id, 'down'), strings.movedDown(view.name));
            },
          },
        ]
      : []),
    ...sharing,
    // Lock and the default are owners' and admins' (views.manage): absent for members, never disabled.
    ...(canManage
      ? [
          ...entry(reasonFor('lock'), {
            id: view.isLocked ? 'unlock' : 'lock',
            label: view.isLocked ? strings.unlock : strings.lock,
            icon: view.isLocked ? 'lock-open' : 'lock',
            startsGroup: sharing.length === 0,
            run: () => {
              run(
                data.views.setLocked(slug, view.id, !view.isLocked),
                view.isLocked ? strings.unlocked(view.name) : strings.locked(view.name),
              );
            },
          }),
          // Already the default: nothing to set, so it is left out.
          ...(facts.isDefault
            ? []
            : entry(reasonFor('setDefault'), {
                id: 'set-default',
                label: strings.setDefault,
                icon: 'star',
                run: () => {
                  run(
                    data.views.setDefault(slug, object.id, view.id),
                    strings.isDefaultNow(view.name, object.pluralName),
                  );
                },
              })),
        ]
      : []),
    ...entry(reasonFor('delete'), {
      id: 'delete',
      label: strings.deleteView,
      icon: 'trash',
      isDanger: true,
      startsGroup: true,
      run: () => {
        setDeleteFailure(undefined);
        setDeleting(true);
      },
    }),
  ];
  const runs = new Map(entries.map((each) => [each.id, each.run]));
  const remove = () => {
    if (isBusy) return;
    setBusy(true);
    setDeleteFailure(undefined);
    onDeleting(true);
    data.views.remove(slug, object.id, view.id).then(
      () => {
        setBusy(false);
        setDeleting(false);
        onDeleted(view.name);
      },
      (error: unknown) => {
        // The confirm stays open with what went wrong, so the person can try again or cancel.
        setBusy(false);
        onDeleting(false);
        setDeleteFailure(isDataError(error) ? error.message : strings.actionFailed);
      },
    );
  };

  return {
    actions: entries.map(({ run: _run, ...action }) => action),
    onAction: (id) => {
      runs.get(id)?.();
    },
    dialogs: (
      <>
        <RenameViewDialog
          isOpen={isRenaming}
          name={view.name}
          onClose={() => setRenaming(false)}
          onRename={(name) => data.views.update(slug, view.id, { name })}
        />
        <Modal
          title={
            view.visibility === 'workspace'
              ? strings.deleteSharedTitle(view.name)
              : strings.deletePrivateTitle(view.name)
          }
          tone="danger"
          isOpen={isDeleting}
          isBusy={isBusy}
          onOpenChange={(open) => {
            if (!open && !isBusy) setDeleting(false);
          }}
          actions={
            <>
              <Button slot="close" isDisabled={isBusy} kbd="ESC">
                {strings.cancel}
              </Button>
              <Button variant="danger-solid" isPending={isBusy} onPress={remove}>
                {isBusy ? strings.deleting : strings.deleteView}
              </Button>
            </>
          }
        >
          {deleteFailure !== undefined && <Callout tone="danger">{deleteFailure}</Callout>}
          {view.visibility === 'workspace' ? strings.deleteSharedText : strings.deletePrivateText}
        </Modal>
      </>
    ),
  };
}

/** Props for the rename dialog. */
interface RenameViewDialogProps {
  readonly isOpen: boolean;
  readonly name: string;
  readonly onClose: () => void;
  readonly onRename: (name: string) => Promise<View>;
}

/** Rename: one Field, the create dialog's rules and refusals; Save waits for the server. */
function RenameViewDialog({ isOpen, name, onClose, onRename }: RenameViewDialogProps) {
  const formId = useId();
  const [isBusy, setBusy] = useState(false);
  return (
    <Modal
      title={strings.renameTitle}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy} kbd="⌘↵">
            {isBusy ? strings.renaming : strings.rename}
          </Button>
        </>
      }
    >
      {isOpen && (
        <RenameForm
          formId={formId}
          name={name}
          isBusy={isBusy}
          onBusyChange={setBusy}
          onRename={onRename}
          onDone={onClose}
        />
      )}
    </Modal>
  );
}

function RenameForm({
  formId,
  name,
  isBusy,
  onBusyChange,
  onRename,
  onDone,
}: {
  readonly formId: string;
  readonly name: string;
  readonly isBusy: boolean;
  readonly onBusyChange: (isBusy: boolean) => void;
  readonly onRename: (name: string) => Promise<View>;
  readonly onDone: () => void;
}) {
  const [value, setValue] = useState(name);
  const [refusals, setRefusals] = useState<readonly FormRefusal[]>([]);
  return (
    <Form
      id={formId}
      isBusy={isBusy}
      refusals={refusals}
      fieldFor={(refusal) => refusal.attributeId}
      label={strings.renameTitle}
      focusesFirstField
      onSubmit={() => {
        if (isBusy) return;
        if (value.trim() === '') {
          setRefusals([{ code: 'INPUT_INVALID', message: strings.nameMissing, attributeId: 'name' }]);
          return;
        }
        if (value.trim() === name) {
          onDone();
          return;
        }
        onBusyChange(true);
        onRename(value.trim()).then(
          () => {
            onBusyChange(false);
            onDone();
          },
          (error: unknown) => {
            onBusyChange(false);
            if (!isDataError(error)) {
              setRefusals([{ code: 'INTERNAL', message: strings.actionFailed }]);
              return;
            }
            const [first] = error.data?.refusals ?? [];
            setRefusals([
              {
                code: first?.code ?? error.code,
                message: first?.message ?? error.message,
                ...(first?.field === 'name' ? { attributeId: 'name' } : {}),
              },
            ]);
          },
        );
      }}
    >
      <Field
        label={strings.viewName}
        name="name"
        autoComplete="off"
        isRequired
        maxLength={100}
        showCounter
        value={value}
        onChange={setValue}
      />
    </Form>
  );
}
