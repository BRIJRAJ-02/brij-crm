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

/** The bell once the record's follow is held: pressed while following, quiet while it loads, gone if it failed. */
function Bell({ slug, recordId, held }: FollowButtonProps & { readonly held: FollowHeld }) {
  const { data } = useRouteContext({ from: '__root__' });
  const state = useFollow(held);
  if (state.status === 'error') return null;
  const following = state.status === 'ready' && state.following;
  return (
    <Tooltip content={following ? strings.following : strings.followHint}>
      <ToggleButton
        variant="ghost"
        icon="bell"
        label={strings.follow}
        isSelected={following}
        isDisabled={state.status === 'loading'}
        onChange={(next) => {
          void data.follows.set(slug, recordId, next);
        }}
      />
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
  if (held === undefined) {
    return <ToggleButton variant="ghost" icon="bell" label={strings.follow} isDisabled />;
  }
  return <Bell slug={slug} recordId={recordId} held={held} />;
}
