// Brief
// Purpose: the one header both Captures editors share (a booking page's, a form's): Copy link once there is a link, Preview where it
// applies, Publish changes where there are drafts, then a ⋯ menu.
// Main task: copy the link, and from the menu Pause or Resume, Duplicate, and Delete (which asks first in a Modal).
// Leaves out: the editor's status (EditorStatus in the TopBar's meta) and what each action does (the editor's).
import { Button, CopyButton, Menu, MenuItem, MenuSeparator, MenuTrigger, type IconName } from '@crm/ui';
import type { ReactNode, RefObject } from 'react';
import { strings } from './strings.ts';

/** One more menu item an editor adds before the divider (a form's "File earlier submissions again"). */
export interface EditorExtraAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly description?: string;
  readonly onAction: () => void;
}

/** Props for EditorActions. */
export interface EditorActionsProps {
  /** The public link Copy link copies; left out while there is none yet (a form never published), so Copy link hides. */
  readonly link?: string;
  /** The editor's Preview button, where it applies (a form's; a booking page shows its preview beside the editor). */
  readonly preview?: ReactNode;
  /** A primary action before the menu: a form's Publish changes, while there are unpublished edits. */
  readonly publish?: ReactNode;
  /** The menu, when the reader may change the subject. Without it, only Copy link (and Preview) show. */
  readonly menu?: {
    /** Live or paused now: the menu offers Pause or Resume to match. Undefined offers neither (a form not yet published). */
    readonly status?: 'live' | 'paused';
    readonly onPause: () => void;
    readonly onResume: () => void;
    readonly onDuplicate: () => void;
    /** Opens the editor's delete confirm. */
    readonly onDelete: () => void;
    /** "Delete booking page", "Delete form". */
    readonly deleteLabel: string;
    readonly extra?: readonly EditorExtraAction[];
    /** Where focus goes back to after an action that leaves (Publish changes, gone once done). */
    readonly triggerRef?: RefObject<HTMLButtonElement | null>;
  };
}

/** The editors' header actions, in one order on both: Copy link, Preview, Publish changes, then ⋯. */
export function EditorActions({ link, preview, publish, menu }: EditorActionsProps) {
  return (
    <>
      {link !== undefined && (
        // On a phone the words fold to the icon, so the name keeps its room.
        <CopyButton value={link} label={strings.copyLink} announcement={strings.linkCopied} isLabelCollapsible />
      )}
      {preview}
      {publish}
      {menu !== undefined && (
        <MenuTrigger>
          <Button
            {...(menu.triggerRef === undefined ? {} : { ref: menu.triggerRef })}
            variant="ghost"
            icon="ellipsis"
            label={strings.moreActions}
          />
          <Menu
            label={strings.moreActions}
            onAction={(key) => {
              if (key === 'pause') menu.onPause();
              if (key === 'resume') menu.onResume();
              if (key === 'duplicate') menu.onDuplicate();
              if (key === 'delete') menu.onDelete();
              menu.extra?.find((each) => each.id === key)?.onAction();
            }}
          >
            {menu.status === 'live' && (
              <MenuItem id="pause" icon="pause">
                {strings.pause}
              </MenuItem>
            )}
            {menu.status === 'paused' && (
              <MenuItem id="resume" icon="play">
                {strings.resume}
              </MenuItem>
            )}
            <MenuItem id="duplicate" icon="layers">
              {strings.duplicate}
            </MenuItem>
            {(menu.extra ?? []).map((each) => (
              <MenuItem
                key={each.id}
                id={each.id}
                icon={each.icon}
                {...(each.description === undefined ? {} : { description: each.description })}
              >
                {each.label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem id="delete" icon="trash" isDanger>
              {menu.deleteLabel}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      )}
    </>
  );
}
