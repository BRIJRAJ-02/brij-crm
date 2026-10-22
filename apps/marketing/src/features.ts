// Every area of Timefix and the features it holds. Only what is built is listed, each line checked against the code
// (the inventory of 22 Oct 2026, verified line by line on 23 Oct: numbers corrected, nothing unbuilt kept);
// planned work stays off the page.
import type { Hue, IconName } from '@crm/ui';

/** One area of the product and its features. */
export interface FeatureGroup {
  readonly id: string;
  readonly title: string;
  readonly icon: IconName;
  readonly hue: Hue;
  readonly features: readonly string[];
}

/** The areas, in the order a new team meets them. */
export const FEATURE_GROUPS: readonly FeatureGroup[] = [
  {
    id: 'booking-pages',
    title: 'Booking pages',
    icon: 'calendar-check',
    hue: 'sky',
    features: [
      'Up to four meeting lengths',
      'Video, phone or in person',
      'Buffers, notice and daily limits',
      'Public or private links',
      'Your profile at timefix.com/you',
      'Times in the visitor’s time zone',
      'Book by typing “next Tuesday afternoon”',
      'See when you’re both free',
      'Guests reschedule or cancel on their own',
    ],
  },
  {
    id: 'bookings',
    title: 'Bookings and calendars',
    icon: 'calendar-days',
    hue: 'green',
    features: [
      'Week view beside your events',
      'Upcoming, past and canceled',
      'Reschedule, cancel or mark a no-show',
      'Block time',
      'Several schedules, with days off',
      'Google Calendar, up to six accounts',
      'Conflict checks per calendar',
      'Confirmations and reminders by email',
      'Add to Google, Outlook or Apple',
    ],
  },
  {
    id: 'records',
    title: 'Records',
    icon: 'table',
    hue: 'yellow',
    features: [
      'Custom objects',
      'Fifteen attribute types',
      'Validation rules',
      'Relationships between records',
      'Saved views with filters, sorts and groups',
      'A timeline on every record',
      'Bulk edit, paste and undo',
      'CSV import with preview and undo',
      'CSV export of any view',
      'Trash with 30 days to restore',
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    icon: 'kanban',
    hue: 'red',
    features: ['Board by stage', 'Drag and drop, keyboard too', 'Value and time in stage', 'Group and sort any view'],
  },
  {
    id: 'forms',
    title: 'Forms',
    icon: 'clipboard-list',
    hue: 'orange',
    features: [
      'Eleven answer types',
      'Show when conditions',
      'Draft, preview, publish',
      'Hosted link, inline, popup or floating',
      'Your own HTML, or posts from your server',
      'End on a booking page, prefilled',
      'Spam protection and a review queue',
      'UTM and source tagging',
      'Submissions filed onto your records',
    ],
  },
  {
    id: 'round-robin',
    title: 'Round robin and routing',
    icon: 'users-round',
    hue: 'lime',
    features: [
      'Rotations with weighted fair share',
      'Fixed hosts beside a rotation',
      'A distribution report',
      'Reassign a booking',
      'Routing rules for forms and team pages',
    ],
  },
  {
    id: 'home',
    title: 'Home',
    icon: 'layout-dashboard',
    hue: 'blue',
    features: [
      'A setup checklist',
      'Today’s meetings',
      'My tasks due today or overdue',
      'Recently viewed',
      'New captures',
      'Who on the team is busy today',
      'This week’s numbers',
      '⌘K to search and act',
    ],
  },
  {
    id: 'team',
    title: 'Team',
    icon: 'users',
    hue: 'sky',
    features: [
      'Invite by email or by link',
      'Owner, Admin and Member roles',
      'Ask to join by email domain',
      'Comments with mentions and reactions',
      'An inbox for mentions and assignments',
      'Tasks with due dates',
      'Notes with a slash menu',
      'An email digest, one click to unsubscribe',
    ],
  },
  {
    id: 'security',
    title: 'Security',
    icon: 'shield-check',
    hue: 'gray',
    features: [
      'Google or an emailed code',
      'Two-factor with backup codes',
      'Require two-factor for everyone',
      'Signed in devices and new sign in alerts',
      'Session length and sign out everywhere',
      'Every request checked on the server',
      'Deleted workspaces kept for 30 days',
    ],
  },
];
