// Brief
// Purpose: the member panel's Works in row (spec 0065 H7, AC-6594): which businesses and places a member may work in,
// for owners and admins, only once the workspace has a choice to make (two businesses, or a business with two places).
// Main task: read where someone works in a few words; open it to choose Every business, a business whole, or some of
// its places; the choice saves as it is picked, and comes back with the reason if it was refused.
// Leaves out: a permission grid and any menu level (the spec has none), and People, which a role governs (AC-6515).
import { isDataError, type DataLayer, type MemberReachView, type MemberView } from '@crm/data';
import { Select, sharedStrings, type Toasts } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { strings } from './members-strings.ts';
import { reachFromValues, worksInItems, worksInMatters, worksInValues } from './works-in.ts';

/** A member's reach as their panel holds it: undefined while it loads, or when there is no choice to show. */
export function useWorksIn(
  data: DataLayer,
  slug: string,
  member: MemberView | undefined,
  isOn: boolean,
  /** Whether the panel is open: each opening reads the reach again, another admin may have changed it. */
  isOpen: boolean,
): readonly [MemberReachView | undefined, (next: MemberReachView) => void] {
  const [view, setView] = useState<MemberReachView>();
  const memberId = member?.id;
  useEffect(() => {
    // A guest works nowhere in the business apps, so there is nothing to choose for them.
    if (!isOn || !isOpen || memberId === undefined || member?.role === 'guest') return;
    let isCurrent = true;
    Promise.resolve()
      .then(() => data.hospitality.load())
      .then((store) => store.memberReach(slug, memberId))
      .then(
        (read) => {
          if (isCurrent) setView(read);
        },
        // Every business app off, or no access: the row stays away rather than saying something it can't do.
        () => undefined,
      );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, memberId, member?.role, isOn, isOpen]);
  // Another member's read, kept from the panel's last opening, never shows here; nor for someone made a guest since.
  const shown =
    isOn && member?.role !== 'guest' && view !== undefined && view.memberId === memberId && worksInMatters(view)
      ? view
      : undefined;
  return [shown, setView];
}

/** Props for the Works in row's value. */
export interface WorksInProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly toasts: Toasts;
  readonly member: MemberView;
  readonly view: MemberReachView;
  readonly onChange: (next: MemberReachView) => void;
}

/**
 * The Works in value: plain words for an owner or admin, who always work in every business (a control that couldn't
 * change it would lie), else a multiple choice Select saved as it is picked, shown at once and put back on a refusal.
 */
export function WorksIn({ data, slug, toasts, member, view, onChange }: WorksInProps) {
  // Each pick saves the whole choice; only the latest pick's answer lands, so quick picks never undo each other.
  const latest = useRef(0);
  const pending = useRef(0);
  // What the server last confirmed: a refusal puts this back, never another pick still on its way.
  const confirmed = useRef(view);
  if (view.fixed) return strings.worksIn.every;
  const values = worksInValues(view.reach);
  return (
    <Select
      label={strings.worksIn.label(member.name)}
      isLabelHidden
      variant="inline"
      selectionMode="multiple"
      items={worksInItems(view, { every: strings.worksIn.every, allOf: strings.worksIn.allOf })}
      // A long choice ends in "+N" rather than a cut word, as the field set's multiple choices do.
      maxVisible={3}
      values={values}
      onValuesChange={(chosen) => {
        const reach = reachFromValues(view, [...chosen], values);
        // With nothing on its way, what shows is what the server holds.
        if (pending.current === 0) confirmed.current = view;
        onChange({ ...view, reach });
        latest.current += 1;
        pending.current += 1;
        const pick = latest.current;
        void data.hospitality
          .load()
          .then((store) => store.setMemberReach(slug, member.id, reach))
          .then(
            (answer) => {
              pending.current -= 1;
              if (!isDataError(answer)) confirmed.current = answer;
              if (pick !== latest.current) return;
              if (isDataError(answer)) {
                onChange(confirmed.current);
                toasts.toast({ tone: 'danger', message: answer.message });
                return;
              }
              onChange(answer);
            },
            () => {
              pending.current -= 1;
              if (pick !== latest.current) return;
              onChange(confirmed.current);
              toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
            },
          );
      }}
    />
  );
}
