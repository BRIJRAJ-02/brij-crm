import { Clock, ListChecks, Bell } from 'lucide-react';
import { DisclosureGroup, DisclosureItem, ShowMore } from './Disclosure.tsx';
import { Count, Tag } from '../Tag/Tag.tsx';
import { Switch, Checkbox } from '../Checkbox/Checkbox.tsx';

const i = { size: 16, strokeWidth: 1.75 } as const;

export function DisclosureDemo() {
  return (
    <div className="tf-demo" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-24)', alignItems: 'start' }}>
      <div className="tf-stack">
        <p className="tf-demo-label" style={{ margin: 0 }}>Single: opening one closes the other</p>
        <DisclosureGroup defaultExpandedKeys={['hours']}>
          <DisclosureItem id="hours" icon={<Clock {...i} />} title="Availability" description="Mon to Fri, 9:00 to 17:00" end={<Tag size="sm" status="done">Set</Tag>}>
            Guests can book Discovery call 30 min in these hours, with 15 minutes between meetings.
          </DisclosureItem>
          <DisclosureItem id="questions" icon={<ListChecks {...i} />} title="Booking questions" description="Name, email and 2 more" end={<Count>4</Count>}>
            Ask for a company name and what they want to cover. Phone number is optional.
          </DisclosureItem>
          <DisclosureItem id="notify" icon={<Bell {...i} />} title="Notifications" description="Email and reminders">
            Priya Raman gets an email for each booking; guests get a reminder 24 hours before.
          </DisclosureItem>
          <DisclosureItem id="payments" title="Payments" description="Connect Stripe first" isDisabled>Not available.</DisclosureItem>
        </DisclosureGroup>
      </div>
      <div className="tf-stack" style={{ gap: 'var(--space-20)' }}>
        <div>
          <p className="tf-demo-label">Multiple, plain rows (FAQ)</p>
          <DisclosureGroup variant="plain" allowsMultipleExpanded>
            <DisclosureItem title="Can guests reschedule?">Yes, from the link in their confirmation email, up to 4 hours before.</DisclosureItem>
            <DisclosureItem title="Which calendars are checked?">Google and Outlook calendars you connect in Settings › Calendars.</DisclosureItem>
            <DisclosureItem title="Is there a booking limit?">Set one per day or per week under Limits.</DisclosureItem>
          </DisclosureGroup>
        </div>
        <div>
          <p className="tf-demo-label">Show advanced (settings)</p>
          <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
            <Switch defaultSelected>Ask guests for a phone number</Switch>
            <ShowMore>
              <div className="tf-stack" style={{ gap: 'var(--space-8)' }}>
                <Checkbox defaultSelected>Hide the event from the booking page</Checkbox>
                <Checkbox>Lock the time zone to Europe/London</Checkbox>
                <Checkbox>Require a confirmation before booking</Checkbox>
              </div>
            </ShowMore>
          </div>
        </div>
      </div>
    </div>
  );
}
