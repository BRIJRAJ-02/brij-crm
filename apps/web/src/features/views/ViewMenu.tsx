// Brief
// Purpose: everything you can do to the view you're on (spec 0020, AC-473 to AC-477, AC-490).
// Main task: pick an action from "More view actions"; one you can't take is there, disabled, saying why.
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
import { Button, Field, Form, Menu, MenuItem, MenuSeparator, MenuTrigger, Modal, type FormRefusal } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the view menu. */
export interface ViewMenuProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly view: View;
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

/** "More view actions": the view's Menu, its Rename dialog and its Delete confirm. */
export function ViewMenu({
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
}: ViewMenuProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const [isRenaming, setRenaming] = useState(false);
  const [isDeleting, setDeleting] = useState(false);
  const [isBusy, setBusy] = useState(false);
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
  const reasonFor = (action: ViewAction): string | undefined => {
    const reason: ViewRuleReason | undefined = viewRule(action, caller, facts);
    if (reason === undefined) return undefined;
    switch (reason) {
      case 'locked':
        return strings.viewLocked;
      case 'default':
        return action === 'delete' ? strings.deleteDefault(object.pluralName) : strings.defaultShared;
      case 'defaultFirst':
        return strings.defaultFirst;
      case 'seeded':
        return strings.seededShared;
      case 'creatorGone':
        return strings.creatorGone;
      case 'notCreator':
        return strings.onlyCreator(memberName(members, view.creatorMemberId));
      case 'unlockFirst':
        return strings.unlockFirst;
      case 'private':
        return strings.shareFirst;
      case 'manage':
      case 'already':
        return strings.nothingToDo;
    }
  };
  // Move up and down within its group: the shared views after the default, or this person's private ones.
  const group = list.views.filter((each) => each.visibility === view.visibility && each.id !== list.defaultViewId);
  const at = group.findIndex((each) => each.id === view.id);
  const moveReason = (direction: 'up' | 'down') =>
    reasonFor('move') ??
    (at === -1
      ? strings.nothingToDo
      : direction === 'up' && at === 0
        ? strings.alreadyFirst
        : direction === 'down' && at === group.length - 1
          ? strings.alreadyLast
          : undefined);

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

  type Item = {
    readonly id: string;
    readonly label: string;
    readonly icon: Parameters<typeof MenuItem>[0]['icon'];
    readonly reason?: string | undefined;
    readonly isDanger?: boolean;
    readonly onAction: () => void;
  };
  const items: (Item | 'separator')[] = [
    {
      id: 'rename',
      label: strings.rename,
      icon: 'pencil',
      reason: reasonFor('edit'),
      onAction: () => setRenaming(true),
    },
    { id: 'duplicate', label: strings.duplicate, icon: 'copy', onAction: onDuplicate },
    {
      id: 'copy-link',
      label: strings.copyLink,
      icon: 'link',
      reason: copyLinkReason,
      onAction: () => {
        navigator.clipboard.writeText(window.location.href).then(
          () => {
            toasts.toast({ tone: 'success', message: strings.linkCopied });
          },
          () => {
            toasts.toast({ tone: 'danger', message: strings.copyFailed });
          },
        );
      },
    },
    'separator',
    {
      id: 'move-up',
      label: strings.moveUp,
      icon: 'arrow-up',
      reason: moveReason('up'),
      onAction: () => {
        run(data.views.move(slug, object.id, view.id, 'up'), strings.movedUp(view.name));
      },
    },
    {
      id: 'move-down',
      label: strings.moveDown,
      icon: 'arrow-down',
      reason: moveReason('down'),
      onAction: () => {
        run(data.views.move(slug, object.id, view.id, 'down'), strings.movedDown(view.name));
      },
    },
    'separator',
    view.visibility === 'private'
      ? {
          id: 'share',
          label: strings.shareWithEveryone,
          icon: 'users',
          reason: reasonFor('share'),
          onAction: () => {
            run(data.views.update(slug, view.id, { visibility: 'workspace' }), strings.shared(view.name));
          },
        }
      : {
          id: 'make-private',
          label: strings.makePrivate,
          icon: 'lock',
          reason: reasonFor('makePrivate'),
          onAction: () => {
            run(data.views.update(slug, view.id, { visibility: 'private' }), strings.madePrivate(view.name));
          },
        },
    // Lock and the default are owners' and admins' (views.manage): hidden for members.
    ...(canManage
      ? [
          view.isLocked
            ? {
                id: 'unlock',
                label: strings.unlock,
                icon: 'lock-open' as const,
                reason: reasonFor('lock'),
                onAction: () => {
                  run(data.views.setLocked(slug, view.id, false), strings.unlocked(view.name));
                },
              }
            : {
                id: 'lock',
                label: strings.lock,
                icon: 'lock' as const,
                reason: reasonFor('lock'),
                onAction: () => {
                  run(data.views.setLocked(slug, view.id, true), strings.locked(view.name));
                },
              },
          {
            id: 'set-default',
            label: strings.setDefault,
            icon: 'star' as const,
            reason: facts.isDefault ? strings.alreadyDefault : reasonFor('setDefault'),
            onAction: () => {
              run(data.views.setDefault(slug, object.id, view.id), strings.isDefaultNow(view.name, object.pluralName));
            },
          },
        ]
      : []),
    'separator',
    {
      id: 'delete',
      label: strings.deleteView,
      icon: 'trash',
      isDanger: true,
      reason: reasonFor('delete'),
      onAction: () => setDeleting(true),
    },
  ];
  const actions = new Map(items.flatMap((item) => (item === 'separator' ? [] : [[item.id, item] as const])));

  return (
    <>
      <MenuTrigger>
        <Button variant="ghost" icon="ellipsis" label={strings.moreViewActions} />
        <Menu
          label={strings.moreViewActions}
          onAction={(key) => {
            actions.get(String(key))?.onAction();
          }}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <MenuSeparator key={`separator-${String(index)}`} />
            ) : (
              <MenuItem
                key={item.id}
                id={item.id}
                icon={item.icon}
                isDisabled={item.reason !== undefined}
                {...(item.reason === undefined ? {} : { description: item.reason })}
                {...(item.isDanger === true ? { isDanger: true } : {})}
              >
                {item.label}
              </MenuItem>
            ),
          )}
        </Menu>
      </MenuTrigger>
      <RenameViewDialog
        isOpen={isRenaming}
        name={view.name}
        onClose={() => setRenaming(false)}
        onRename={(name) => data.views.update(slug, view.id, { name })}
      />
      <Modal
        title={
          view.visibility === 'workspace' ? strings.deleteSharedTitle(view.name) : strings.deletePrivateTitle(view.name)
        }
        tone="danger"
        isOpen={isDeleting}
        onOpenChange={(open) => {
          if (!open && !isBusy) setDeleting(false);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isBusy} kbd="ESC">
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              isPending={isBusy}
              onPress={() => {
                setBusy(true);
                onDeleting(true);
                data.views.remove(slug, object.id, view.id).then(
                  () => {
                    setBusy(false);
                    setDeleting(false);
                    onDeleted(view.name);
                  },
                  (error: unknown) => {
                    setBusy(false);
                    setDeleting(false);
                    onDeleting(false);
                    toasts.toast({
                      tone: 'danger',
                      message: isDataError(error) ? error.message : strings.actionFailed,
                    });
                  },
                );
              }}
            >
              {isBusy ? strings.deleting : strings.deleteView}
            </Button>
          </>
        }
      >
        {view.visibility === 'workspace' ? strings.deleteSharedText : strings.deletePrivateText}
      </Modal>
    </>
  );
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
