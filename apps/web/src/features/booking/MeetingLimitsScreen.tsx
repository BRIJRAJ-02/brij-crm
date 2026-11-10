// Brief
// Purpose: Bookings settings › Meeting limits (spec 0037, AC-1297 to AC-1299), moved out of Availability into the mock's Meetings group (10 November 2026): one home for how many meetings a person takes across every page.
// Main task: pick a day's and a week's limit; a reader who reaches a colleague's scheduling picks whose limits show first.
// Leaves out: a page's own daily limit (the page's Limits), rotation caps (the team's settings), and any new setting.
import type { DataLayer, VisibleMember } from '@crm/data';
import { useNavigate } from '@tanstack/react-router';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { LimitsCard, LimitsCardPending } from './LimitsCard.tsx';
import { meetingLimitsHref } from './links.ts';
import { limitsStrings as strings } from './limits-strings.ts';
import { WhoseSelect } from './WhoseSelect.tsx';

/** Props for the page. */
export interface MeetingLimitsScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The colleague whose limits show; undefined for the reader's own. */
  readonly member: string | undefined;
  /** Whose scheduling the reader may see (`members.visible`, AC-1268), the reader first. */
  readonly members: readonly VisibleMember[];
  /** The reader's own member id. */
  readonly me: string;
}

/** The page: the limits Card, with Whose limits at the bar's end once there is a colleague to pick. */
export function MeetingLimitsScreen({ data, slug, member, members, me }: MeetingLimitsScreenProps) {
  const navigate = useNavigate();
  const viewed = member === undefined ? undefined : members.find((each) => each.id === member);
  const whose = viewed === undefined ? undefined : { id: viewed.id, name: viewed.name };
  const hasColleagues = members.some((each) => each.id !== me);
  return (
    <SettingsPage
      title={strings.title}
      {...(hasColleagues
        ? {
            actions: (
              <WhoseSelect
                label={strings.whose}
                mine={strings.whoseMine}
                theirs={strings.whoseTheirs}
                members={members}
                me={me}
                value={whose?.id ?? me}
                onChange={(id) => void navigate({ href: meetingLimitsHref(slug, id === me ? undefined : id) })}
              />
            ),
          }
        : {})}
    >
      <LimitsCard data={data} slug={slug} member={whose} />
    </SettingsPage>
  );
}

/** The page while it loads: the Card's rows, each control a placeholder. */
export function MeetingLimitsPending() {
  return (
    <SettingsPage title={strings.title} isLoading>
      <LimitsCardPending />
    </SettingsPage>
  );
}
