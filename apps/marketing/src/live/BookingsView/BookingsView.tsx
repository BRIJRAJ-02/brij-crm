import { Button, MeetingCard, WeekCalendar, type WeekCalendarBlock } from '@crm/ui';
import { useState } from 'react';
import {
  type DemoMeeting,
  type DemoPerson,
  COMPANIES,
  MEMBERS,
  NOW_MINUTE,
  TODAY,
  WEEKS,
  clockLabel,
  shortDay,
  spanLabel,
  weekOf,
} from '../data.ts';
import { ViewHeader } from '../ViewHeader/ViewHeader.tsx';
import styles from './BookingsView.module.css';

/** Props for BookingsView. */
export interface BookingsViewProps {
  readonly meetings: readonly DemoMeeting[];
  readonly people: readonly DemoPerson[];
  /** The meeting whose card is open. */
  readonly openId: string | undefined;
  readonly onOpen: (id: string | undefined) => void;
  /** Opens the guest's record. */
  readonly onOpenPerson: (personId: string) => void;
  /** The week shown, by its Monday: this week (19) or the next (26). */
  readonly week: (typeof WEEKS)[number];
  readonly onWeekChange: (week: (typeof WEEKS)[number]) => void;
}

/** "9 AM", "12 PM". */
const hourLabel = (hour: number) => `${String(hour % 12 === 0 ? 12 : hour % 12)} ${hour < 12 ? 'AM' : 'PM'}`;

/** The live demo's Bookings: the team's week, each booking's card a click away. */
export function BookingsView({
  meetings,
  people,
  openId,
  onOpen,
  onOpenPerson,
  week,
  onWeekChange,
}: BookingsViewProps) {
  const days = weekOf(week);
  const [selectedDay, setSelectedDay] = useState(week === WEEKS[0] ? TODAY : (days[0]?.key ?? TODAY));
  const personOf = (meeting: DemoMeeting) => people.find((person) => person.id === meeting.personId);
  const blocks: WeekCalendarBlock[] = meetings
    .filter((meeting) => days.some((day) => day.key === meeting.dayKey))
    .map((meeting) => ({
      id: meeting.id,
      dayKey: meeting.dayKey,
      startMinute: meeting.startMinute,
      endMinute: meeting.endMinute,
      title: meeting.kind === 'booking' ? (personOf(meeting)?.name ?? meeting.title) : meeting.title,
      time: spanLabel(meeting.startMinute, meeting.endMinute),
      ...(meeting.kind === 'booking' ? { detail: meeting.title } : {}),
      kind: meeting.kind,
    }));
  const open = meetings.find((meeting) => meeting.id === openId);
  const guest = open === undefined ? undefined : personOf(open);
  const company = COMPANIES.find((candidate) => candidate.id === guest?.companyId);
  const host = MEMBERS.find((member) => member.id === open?.hostId);
  const isThisWeek = week === WEEKS[0];

  return (
    <div className={styles.root}>
      <ViewHeader
        icon="calendar-days"
        hue="blue"
        title="Bookings"
        count={blocks.filter((block) => block.kind === 'booking').length}
        actions={
          <>
            <Button
              size="lg"
              icon="chevron-left"
              label="Previous week"
              isDisabled={isThisWeek}
              onPress={() => {
                onWeekChange(WEEKS[0]);
              }}
            />
            <Button
              size="lg"
              icon="chevron-right"
              label="Next week"
              isDisabled={!isThisWeek}
              onPress={() => {
                onWeekChange(WEEKS[1]);
              }}
            />
          </>
        }
      />
      <div className={styles.calendar}>
        <WeekCalendar
          label={`Bookings, ${days[0]?.long ?? ''} to ${days[6]?.long ?? ''}`}
          days={days.map((day) => ({
            key: day.key,
            weekday: day.weekday,
            dayNumber: String(day.dayNumber),
            label: day.long,
            isToday: day.key === TODAY,
            isPast: day.key < TODAY,
          }))}
          blocks={blocks}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          hourLabel={hourLabel}
          minuteLabel={clockLabel}
          zone={{ short: 'EDT', name: 'New York time (EDT)' }}
          now={{ dayKey: TODAY, minute: NOW_MINUTE }}
          scrollToMinute={8 * 60}
          openId={openId}
          detail={
            open === undefined ? undefined : (
              <MeetingCard
                title={open.kind === 'booking' ? `${open.title} with ${guest?.name ?? 'a guest'}` : open.title}
                when={`${shortDay(open.dayKey)} · ${spanLabel(open.startMinute, open.endMinute)}`}
                status={{
                  label: open.kind === 'booking' ? 'Confirmed' : 'Your calendar',
                  hue: open.kind === 'booking' ? 'green' : 'gray',
                }}
                {...(guest === undefined
                  ? {}
                  : {
                      people: [
                        {
                          id: guest.id,
                          name: guest.name,
                          detail: company === undefined ? guest.title : `${guest.title} at ${company.name}`,
                        },
                      ],
                    })}
                rows={[
                  { id: 'where', icon: 'video', label: 'Where', value: open.where },
                  { id: 'host', icon: 'user', label: 'Host', value: host?.name ?? '' },
                ]}
                {...(guest === undefined
                  ? {}
                  : {
                      actions: (
                        <Button
                          size="lg"
                          icon="user"
                          onPress={() => {
                            onOpenPerson(guest.id);
                          }}
                        >
                          Open record
                        </Button>
                      ),
                    })}
              />
            )
          }
          onOpen={onOpen}
          onClose={() => {
            onOpen(undefined);
          }}
          isFill
        />
      </div>
    </div>
  );
}
