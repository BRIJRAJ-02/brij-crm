// The `@` list: members matching what follows the @, in the library's Popover,
// drawn like a Menu's rows. Focus stays in the editor while it is open (the
// editor's keys move the highlight and pick), so it is a listbox the editor
// points into with aria-activedescendant, not a Menu that takes focus.
import type { ActorDisplay } from '@crm/contracts/values';
import type { RefObject } from 'react';
import { Avatar } from '../atoms/Avatar/Avatar.tsx';
import { Popover } from '../molecules/Popover/Popover.tsx';
import styles from './MentionList.module.css';
import { strings } from './strings.ts';

/** Props for MentionList. */
export interface MentionListProps {
  /** The `@query` the list opens under. */
  readonly anchorRef: RefObject<Element | null>;
  /** The listbox's id, which the editor names in aria-controls. */
  readonly id: string;
  readonly members: readonly ActorDisplay[];
  /** The highlighted row, which Enter picks. */
  readonly activeIndex: number;
  /** Still searching: the list says so until members arrive. */
  readonly isLoading: boolean;
  readonly onPick: (member: ActorDisplay) => void;
  /** The pointer moved onto a row. */
  readonly onHighlight: (index: number) => void;
}

/** An option's id: the listbox's id and the row's place. */
export function mentionOptionId(listId: string, index: number): string {
  return `${listId}-option-${String(index)}`;
}

/** Members to mention, each an Avatar and a name; the highlighted one takes the hover fill. */
export function MentionList({ anchorRef, id, members, activeIndex, isLoading, onPick, onHighlight }: MentionListProps) {
  return (
    <Popover triggerRef={anchorRef} isOpen isNonModal width="menu" placement="bottom start">
      <div className={styles.root} role="listbox" id={id} aria-label={strings.members}>
        {members.length === 0 ? (
          <div className={styles.empty} role="presentation">
            {isLoading ? strings.searchingMembers : strings.noMembers}
          </div>
        ) : (
          members.map((member, index) => (
            <div
              key={member.id ?? member.name}
              id={mentionOptionId(id, index)}
              className={styles.option}
              role="option"
              aria-selected={index === activeIndex}
              data-active={index === activeIndex || undefined}
              tabIndex={-1}
              // The editor keeps focus (and its selection) while a member is picked with the pointer.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                onHighlight(index);
              }}
              onClick={() => {
                onPick(member);
              }}
              onKeyDown={() => undefined}
            >
              <Avatar
                name={member.name}
                id={member.id ?? member.name}
                size="xs"
                isDecorative
                {...(member.imageSrc === undefined ? {} : { src: member.imageSrc })}
                {...(member.hue === undefined ? {} : { hue: member.hue })}
              />
              <span className={styles.name}>{member.name}</span>
              {member.email !== undefined && <span className={styles.email}>{member.email}</span>}
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
