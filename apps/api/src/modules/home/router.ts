import { readHomeMetrics, readTeamToday } from '@crm/core';
import { member } from '../../orpc.ts';

// Home (spec 0041): Team today and the metrics row, each one read through the door's scope. The metrics'
// workspace figures are kept a minute per workspace and week (`context.homeMetrics`).
export const homeRouter = member.home.router({
  teamToday: member.home.teamToday.handler(({ context, input }) =>
    readTeamToday(context.scope, { from: input.from, to: input.to }),
  ),
  metrics: member.home.metrics.handler(({ context, input }) =>
    readHomeMetrics(context.scope, { weekStart: input.weekStart }, { cache: context.homeMetrics }),
  ),
});
