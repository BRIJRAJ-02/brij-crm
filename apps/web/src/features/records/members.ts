// Choosing a member (an Owner) from a cell, a record page row, the create
// form or a bulk edit (spec 0003, Actor reference: a Menu of members, "Me"
// first). The workspace's members come from the route (`members.list`), so a
// search filters them in the browser and never asks the server; the server
// checks every pick is an active member of this workspace on its own.
import { searchMembers, toActorDisplays, type ActorDisplay, type MemberSummary } from '@crm/data';
import { arraySource, type ListSource } from '@crm/ui';
import { useMemo } from 'react';
import { useMyAccess } from '../workspace/WorkspacePage.tsx';
import { editorSearch } from './links.ts';

const keyOf = (member: ActorDisplay) => `${member.type}:${member.id ?? ''}`;

/** What a member editor needs: the members as displays (its chips' names), Me, and its search. */
export interface MemberPicker {
  readonly displays: readonly ActorDisplay[];
  /** The editor's extras: Me pinned first (when the signed in person is a member here), and the search. */
  readonly extras: {
    readonly me?: ActorDisplay;
    readonly onSearch: ReturnType<typeof editorSearch>;
  };
}

/**
 * The member picker for a screen: one per screen, the same for every member
 * attribute on it, made again only when the members or the person change.
 */
export function useMemberPicker(members: readonly MemberSummary[]): MemberPicker {
  const meId = useMyAccess()?.memberId;
  return useMemo(() => {
    const displays = toActorDisplays(members);
    const me = meId === undefined ? undefined : displays.find((member) => member.id === meId);
    // The picker asks on every render it draws, so the last answer is kept until the query changes.
    const answered = new Map<string, ListSource<ActorDisplay>>();
    const search = (query: string) => {
      const held = answered.get(query);
      if (held !== undefined) return held;
      const source = arraySource(searchMembers(displays, query, me?.id ?? undefined), keyOf);
      answered.clear();
      answered.set(query, source);
      return source;
    };
    return {
      displays,
      extras: {
        ...(me === undefined ? {} : { me }),
        onSearch: editorSearch(search),
      },
    };
  }, [members, meId]);
}
