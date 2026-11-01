// Brief
// Purpose: follow a record from its header, on the page and in the panel (collaboration): its changes reach the inbox.
// Main task: one quiet bell that stays pressed while following; pressing it follows or unfollows at once.
// Leaves out: who else follows, and per record mute (the inbox switch in Settings › Notifications covers all).
import type { FollowHeld } from '@crm/data';
import { useFollow } from '@crm/data/react';
import { ToggleButton, Tooltip } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { strings } from './strings.ts';

/** Props for the record's Follow. */
export interface FollowButtonProps {
  readonly slug: string;
  readonly recordId: string;
}

/** The bell once the record's follow is held: pressed while following, disabled while it loads or if it failed. */
function Bell({ held }: { readonly held: FollowHeld }) {
  const state = useFollow(held);
  if (state.status === 'error') return <Placeholder />;
  const following = state.status === 'ready' && state.following;
  return (
    <Tooltip content={following ? strings.unfollowHint : strings.followHint}>
      <ToggleButton
        variant="ghost"
        icon="bell"
        label={strings.follow}
        isSelected={following}
        isDisabled={state.status === 'loading'}
        onChange={(next) => {
          void held.toggle(next);
        }}
      />
    </Tooltip>
  );
}

/** The bell before its follow is read, or when the read failed: in its place, disabled, saying what it is for. */
function Placeholder() {
  return (
    <Tooltip content={strings.followHint}>
      <ToggleButton variant="ghost" icon="bell" label={strings.follow} isDisabled />
    </Tooltip>
  );
}

/**
 * The record's Follow in its header's quick actions. The follows store loads with the first header; until it has,
 * the bell holds its place disabled, so the row never shifts. Give it `key={recordId}`, so a new record starts fresh.
 */
export function FollowButton({ slug, recordId }: FollowButtonProps) {
  const { data } = useRouteContext({ from: '__root__' });
  const [held, setHeld] = useState<FollowHeld | undefined>(undefined);
  useEffect(() => {
    let isLive = true;
    data.follows.forRecord(slug, recordId).then(
      (found) => {
        if (isLive) setHeld(found);
      },
      () => undefined,
    );
    return () => {
      isLive = false;
    };
  }, [data, slug, recordId]);
  return held === undefined ? <Placeholder /> : <Bell held={held} />;
}
