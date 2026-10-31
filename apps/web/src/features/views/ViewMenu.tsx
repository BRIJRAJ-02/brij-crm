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
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { duplicatesHref } from '../duplicates/paths.ts';
import { strings as duplicateStrings } from '../duplicates/strings.ts';
import { trashHref } from '../workspace/objects.ts';
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
  /** The view was deleted here: the screen goes to the default view, offering Undo with the view as it was. */
  readonly onDeleted: (deleted: View) => void;
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
  /** Whether a view in the switcher can move within its group now (Alt with an arrow on its item). */
  readonly isMovable: (viewId: string) => boolean;
  /** Opens Rename, its name selected (right after Duplicate, so no "copy" is kept by accident). */
  readonly rename: () => void;
  /** Moves a view up or down its group, from the switcher's keyboard reorder. */
  readonly onMoveView: (viewId: string, direction: 'up' | 'down') => void;
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
  const navigate = useNavigate();
  const [isRenaming, setRenaming] = useState(false);
  const [isBusy, setBusy] = useState(false);
  // Make private ends everyone else's use of the view, so it asks first, as Delete does.
  const [isGoingPrivate, setGoingPrivate] = useState(false);
  const [isPrivateBusy, setPrivateBusy] = useState(false);
  const [privateFailure, setPrivateFailure] = useState<string | undefined>(undefined);
  if (view === undefined) {
    return {
      actions: [],
      onAction: () => undefined,
      isMovable: () => false,
      onMoveView: () => undefined,
      rename: () => undefined,
      dialogs: null,
    };
  }
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
  // A reason's words, or `null` when it can never apply here and is left out.
  const word = (reason: ViewRuleReason, action?: ViewAction): string | null => {
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
  // An action's reason, or `null` when it can never apply here and is left out.
  const reasonFor = (action: ViewAction): string | undefined | null => {
    const reason: ViewRuleReason | undefined = viewRule(action, caller, facts);
    if (reason === undefined) return undefined;
    if (NEVER.has(reason)) return null;
    return word(reason, action);
  };
  // Any view moves within its group (the shared views after the default, or this person's private ones) from the
  // switcher's keyboard reorder, where the rules let this person move it (the menu's Move up and Move down went).
  const groupOf = (summary: ViewsListSnapshot['views'][number]) =>
    list.views.filter((each) => each.visibility === summary.visibility && each.id !== list.defaultViewId);
  const isMovable = (viewId: string) => {
    const summary = list.views.find((each) => each.id === viewId);
    if (summary === undefined || summary.id === list.defaultViewId || groupOf(summary).length < 2) return false;
    return (
      viewRule('move', caller, {
        visibility: summary.visibility,
        creatorMemberId: summary.creatorMemberId,
        isLocked: summary.isLocked,
        isDefault: false,
      }) === undefined
    );
  };
  const onMoveView = (viewId: string, direction: 'up' | 'down') => {
    const summary = list.views.find((each) => each.id === viewId);
    if (summary === undefined || !isMovable(viewId)) return;
    const group = groupOf(summary);
    const at = group.findIndex((each) => each.id === viewId);
    // Already first or last: nothing to do.
    if (direction === 'up' ? at <= 0 : at >= group.length - 1) return;
    run(
      data.views.move(slug, object.id, viewId, direction),
      direction === 'up' ? strings.movedUp(summary.name) : strings.movedDown(summary.name),
    );
  };

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
  // Who can see it (30 October 2026): one choice of three states in place of Share, Make private and Lock. A state
  // the person could reach after a change stays, disabled, saying why; one they never could is left out.
  const unlocked = { ...facts, isLocked: false };
  const shown: 'private' | 'workspace' | 'locked' =
    view.visibility === 'private' ? 'private' : view.isLocked ? 'locked' : 'workspace';
  const reasonOf = (reason: ViewRuleReason | undefined): string | undefined | null => {
    if (reason === undefined) return undefined;
    if (NEVER.has(reason)) return null;
    return word(reason, 'makePrivate');
  };
  const choiceReason = (to: 'private' | 'workspace' | 'locked'): string | undefined | null => {
    if (to === shown) return undefined;
    // Leaving the locked state unlocks first, which only owners and admins may do.
    if (shown === 'locked' && !canManage) return null;
    if (to === 'private') return reasonOf(viewRule('makePrivate', caller, canManage ? unlocked : facts));
    if (to === 'workspace') return shown === 'private' ? reasonOf(viewRule('share', caller, facts)) : undefined;
    // Locked: owners and admins only, and from private the view is shared first.
    if (!canManage) return null;
    return shown === 'private' ? reasonOf(viewRule('share', caller, facts)) : undefined;
  };
  const whoChoices = (['private', 'workspace', 'locked'] as const).flatMap((to) => {
    const reason = choiceReason(to);
    if (reason === null) return [];
    return [
      {
        id: to,
        label: to === 'private' ? strings.onlyMe : to === 'workspace' ? strings.everyone : strings.everyoneAdminsEdit,
        ...(to === shown ? { isSelected: true } : {}),
        ...(reason === undefined ? {} : { reason }),
      },
    ];
  });
  const sharing: readonly Entry[] =
    whoChoices.length < 2
      ? []
      : [
          {
            id: 'who',
            label: strings.whoCanSee,
            icon: view.visibility === 'private' ? 'lock' : 'users',
            startsGroup: true,
            choices: whoChoices,
            run: () => undefined,
          },
        ];
  const choose = (to: string) => {
    if (to === shown) return;
    if (to === 'private') {
      setPrivateFailure(undefined);
      setGoingPrivate(true);
      return;
    }
    const share = shown === 'private' ? data.views.update(slug, view.id, { visibility: 'workspace' }) : undefined;
    const lockTo = to === 'locked';
    run(
      (share ?? Promise.resolve()).then(() =>
        lockTo || shown === 'locked' ? data.views.setLocked(slug, view.id, lockTo) : undefined,
      ),
      lockTo ? strings.locked(view.name) : shown === 'locked' ? strings.unlocked(view.name) : strings.shared(view.name),
    );
  };
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
    // Import and Export CSV (spec 0040) live in the view bar's Import / Export button alone (owner, 30 Oct 2026).
    ...sharing,
    // The default is owners' and admins' (views.manage): absent for members, never disabled.
    ...(canManage
      ? [
          // Already the default: nothing to set, so it is left out.
          ...(facts.isDefault
            ? []
            : entry(reasonFor('setDefault'), {
                id: 'set-default',
                label: strings.setDefault,
                icon: 'star',
                ...(sharing.length === 0 ? { startsGroup: true } : {}),
                run: () => {
                  run(data.views.setDefault(slug, object.id, view.id), strings.isDefaultNow(view.name));
                },
              })),
        ]
      : []),
    // Deleted records wait in the trash (spec 0022); a delete's toast has room for Undo only, so the way there is here.
    {
      id: 'open-trash',
      label: strings.openTrash,
      icon: 'trash',
      startsGroup: true,
      run: () => {
        void navigate({ href: `${trashHref(slug)}?object=${encodeURIComponent(object.id)}` });
      },
    },
    // Likely duplicates of this object (spec 0049, AC-4907): a page of pairs to merge or dismiss.
    {
      id: 'find-duplicates',
      label: duplicateStrings.findDuplicates,
      icon: 'copy',
      run: () => {
        void navigate({ href: duplicatesHref(slug, object.apiSlug) });
      },
    },
    ...entry(reasonFor('delete'), {
      id: 'delete',
      label: strings.deleteView,
      icon: 'trash',
      isDanger: true,
      startsGroup: true,
      // One click, with Undo in its toast (the owner, 30 October 2026: Undo over a confirm).
      run: () => {
        remove();
      },
    }),
  ];
  const runs = new Map(entries.map((each) => [each.id, each.run]));
  function remove() {
    if (isBusy || view === undefined) return;
    const gone = view;
    setBusy(true);
    onDeleting(true);
    data.views.remove(slug, object.id, gone.id).then(
      () => {
        setBusy(false);
        onDeleted(gone);
      },
      (error: unknown) => {
        setBusy(false);
        onDeleting(false);
        toasts.toast({ tone: 'danger', message: isDataError(error) ? error.message : strings.actionFailed });
      },
    );
  }

  const makePrivate = () => {
    if (isPrivateBusy) return;
    setPrivateBusy(true);
    setPrivateFailure(undefined);
    // A locked view is unlocked on the way (Who can see it goes straight from locked to only me).
    (view.isLocked ? data.views.setLocked(slug, view.id, false) : Promise.resolve(view))
      .then(() => data.views.update(slug, view.id, { visibility: 'private' }))
      .then(
        () => {
          setPrivateBusy(false);
          setGoingPrivate(false);
          toasts.toast({ tone: 'success', message: strings.madePrivate(view.name) });
        },
        (error: unknown) => {
          // The confirm stays open with what went wrong, so the person can try again or cancel.
          setPrivateBusy(false);
          setPrivateFailure(isDataError(error) ? error.message : strings.actionFailed);
        },
      );
  };

  return {
    actions: entries.map(({ run: _run, ...action }) => action),
    onAction: (id) => {
      if (id.startsWith('who/')) choose(id.slice('who/'.length));
      else runs.get(id)?.();
    },
    isMovable,
    onMoveView,
    rename: () => {
      setRenaming(true);
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
          title={strings.makePrivateTitle(view.name)}
          isOpen={isGoingPrivate}
          isBusy={isPrivateBusy}
          onOpenChange={(open) => {
            if (!open && !isPrivateBusy) setGoingPrivate(false);
          }}
          actions={
            <>
              <Button slot="close" isDisabled={isPrivateBusy}>
                {strings.cancel}
              </Button>
              <Button variant="primary" isPending={isPrivateBusy} onPress={makePrivate}>
                {isPrivateBusy ? strings.makingPrivate : strings.makePrivate}
              </Button>
            </>
          }
        >
          {privateFailure !== undefined && <Callout tone="danger">{privateFailure}</Callout>}
          {strings.makePrivateText}
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
          <Button slot="close" isDisabled={isBusy}>
            {strings.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} isPending={isBusy}>
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
      // The name selected, so typing replaces it (Rename right after Duplicate).
      focusesFirstField="select"
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
