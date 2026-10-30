// Home's Team today (spec 0041): every member the reader may view (the
// scheduling reach: an owner or admin everyone, anyone else only themself, the
// owner's ask of 29 October 2026), where they stand now and what is next; a
// teammate's meeting by title only where the reader may see it. For a
// workspace of more than one, and a member with Bookings; a reader who sees
// only their own day gets no card (Today has it).
import { useTeamToday } from '@crm/data/react';
import { Card, TeamList, useFormatSettings, type TeamRow } from '@crm/ui';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useNow } from '../../bookings/useNow.ts';
import { useToday } from '../../tasks/day.ts';
import { dayRange } from '../agenda.ts';
import type { HomeSectionProps } from '../registry.ts';
import { strings } from '../strings.ts';
import { standingOf, teamDaysOf, type TeamMemberDay } from '../team.ts';
import { Failed, locale } from './shared.tsx';
import { useCan } from '../../workspace/WorkspacePage.tsx';

/** How many members Team today draws: the rest are counted. */
export const TEAM_SHOWN = 8;

/** One member's row: where they stand at `now`, and when that changes. A title shows only where the server sent one. */
function teamRowOf(day: TeamMemberDay, meId: string | undefined, now: Date, time: Intl.DateTimeFormat): TeamRow {
  const at = (iso: string) => time.format(new Date(iso));
  const standing = standingOf(day.items, now);
  const next =
    standing.next === undefined
      ? undefined
      : standing.next.title === undefined
        ? strings.busyFrom(at(standing.next.startsAt))
        : strings.next(standing.next.title, at(standing.next.startsAt));
  const busy = standing.presence === 'busy';
  const until = at(standing.until ?? now.toISOString());
  const title = standing.current?.title;
  const detail = busy
    ? [title === undefined ? strings.until(until) : strings.titleUntil(title, until), next]
        .filter((part) => part !== undefined)
        .join(' · ')
    : (next ?? strings.nothingElse);
  return {
    id: day.member.id,
    name: day.member.id === meId ? strings.you(day.member.name) : day.member.name,
    ...(day.member.avatarUrl === undefined ? {} : { avatarSrc: day.member.avatarUrl }),
    // A clear day is free too: the dot never makes the most available person look the least.
    // Away today (spec 0037, AC-1287): never Free now, whatever the calendar says.
    presence: day.away === true ? 'clear' : busy ? 'busy' : 'free',
    status:
      day.away === true
        ? strings.away
        : busy
          ? title === undefined
            ? strings.busy
            : strings.inMeeting
          : strings.freeNow,
    // Away: no calendar line beside it.
    ...(day.away === true ? {} : { detail }),
  };
}

/** Team today. One member is not a team: with only the reader's own day, it draws nothing (Today has it). */
export function TeamSection({ context }: HomeSectionProps) {
  const { slug, members, meId } = context;
  const { data } = useRouteContext({ from: '__root__' });
  // Only `booking.admin` reaches colleagues today (spec 0037 widens the reach): anyone else gets their own day alone,
  // so no card, and none is drawn while it loads either, so nothing comes and goes.
  const reachesTeam = useCan('booking.admin');
  const { timeZone } = useFormatSettings();
  const today = useToday(timeZone);
  const range = useMemo(() => dayRange(today), [today]);
  const view = useMemo(() => data.home.teamToday(slug, range.from, range.to), [data, slug, range]);
  const state = useTeamToday(view);
  const now = useNow();
  const days = useMemo(
    () => (state.status === 'ready' ? teamDaysOf(state.members, members, meId, strings.aTeammate) : []),
    [state, members, meId],
  );
  const time = useMemo(
    () => new Intl.DateTimeFormat(locale(), { hour: 'numeric', minute: '2-digit', timeZone }),
    [timeZone],
  );
  const rows = useMemo(
    () => days.slice(0, TEAM_SHOWN).map((day) => teamRowOf(day, meId, now, time)),
    [days, meId, now, time],
  );
  // Someone who would see only their own day has no card to fail either.
  if (state.status === 'error' && !reachesTeam) return null;
  if (state.status === 'error') {
    return (
      <Card title={strings.teamToday}>
        <Failed
          title={strings.teamFailed}
          message={state.message}
          onRetry={() => {
            view.reload();
          }}
        />
      </Card>
    );
  }
  if (state.status === 'ready' && days.length <= 1) return null;
  if (state.status === 'loading' && !reachesTeam) return null;
  const hidden = days.length - TEAM_SHOWN;
  return (
    <Card
      title={strings.teamToday}
      description={strings.teamDescription}
      isBusy={state.status === 'loading'}
      {...(hidden > 0 ? { footer: strings.moreTeam(hidden) } : {})}
    >
      <TeamList label={strings.teamToday} rows={rows} isLoading={state.status === 'loading'} />
    </Card>
  );
}
