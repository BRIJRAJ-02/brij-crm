import { Avatar, Button, Field, Icon, MonthTiles, SlotList } from '@crm/ui';
import { useState } from 'react';
import {
  type DemoMeeting,
  BOOKING_PAGE,
  MEMBERS,
  OPEN_DAYS,
  TODAY,
  clockLabel,
  freeStarts,
  shortDay,
} from '../data.ts';
import { ViewHeader } from '../ViewHeader/ViewHeader.tsx';
import styles from './BookView.module.css';

/** Props for BookView. */
export interface BookViewProps {
  readonly meetings: readonly DemoMeeting[];
  /** Books the picked time for the named guest; returns nothing, the demo shows the rest. */
  readonly onBook: (booking: { readonly name: string; readonly dayKey: string; readonly startMinute: number }) => void;
}

/** The first day with a free time, so the page opens on something to pick. */
const firstOpenDay = (meetings: readonly DemoMeeting[]) =>
  [...OPEN_DAYS].find((day) => freeStarts(meetings, BOOKING_PAGE.hostId, day).length > 0) ?? TODAY;

/**
 * The live demo's booking page, as a visitor sees Maya's intro call: the library's MonthTiles and SlotList, a name,
 * and Book. Booking adds the meeting to Bookings and the guest to People, at once.
 */
export function BookView({ meetings, onBook }: BookViewProps) {
  const host = MEMBERS.find((member) => member.id === BOOKING_PAGE.hostId);
  const [day, setDay] = useState(() => firstOpenDay(meetings));
  const [slot, setSlot] = useState<string>();
  const [name, setName] = useState('Alex Morgan');
  const starts = freeStarts(meetings, BOOKING_PAGE.hostId, day);
  const openDays = new Set([...OPEN_DAYS].filter((key) => freeStarts(meetings, BOOKING_PAGE.hostId, key).length > 0));
  const picked = slot === undefined ? undefined : Number(slot);
  const canBook = picked !== undefined && starts.includes(picked) && name.trim().length > 0;

  return (
    <div className={styles.root}>
      <ViewHeader icon="calendar-check" hue="sky" title="Booking page" />
      <div className={styles.page}>
        <div className={styles.host}>
          <Avatar name={host?.name ?? ''} id={BOOKING_PAGE.hostId} size="lg" />
          <p className={styles.hostName}>{host?.name}</p>
          <h3 className={styles.title}>{BOOKING_PAGE.title}</h3>
          <p className={styles.fact}>
            <Icon name="clock" size="sm" />
            {BOOKING_PAGE.minutes} min
          </p>
          <p className={styles.fact}>
            <Icon name="video" size="sm" />
            {BOOKING_PAGE.where}
          </p>
          <p className={styles.fact}>
            <Icon name="link" size="sm" />
            {BOOKING_PAGE.address}
          </p>
        </div>
        <div className={styles.month}>
          <MonthTiles
            month="2026-10"
            today={TODAY}
            openDays={openDays}
            value={day}
            onChange={(next) => {
              setDay(next);
              setSlot(undefined);
            }}
            onMonthChange={() => undefined}
            canPrevious={false}
            canNext={false}
          />
        </div>
        <div className={styles.times}>
          <SlotList
            heading={shortDay(day)}
            slots={starts.map((start) => ({ id: String(start), label: clockLabel(start), name: clockLabel(start) }))}
            value={slot}
            onChange={setSlot}
            layout="column"
          />
          <div className={styles.book}>
            <Field label="Your name" value={name} onChange={setName} />
            <Button
              variant="primary"
              size="lg"
              isFullWidth="center"
              isDisabled={!canBook}
              onPress={() => {
                if (picked === undefined) return;
                onBook({ name: name.trim(), dayKey: day, startMinute: picked });
                setSlot(undefined);
              }}
            >
              {picked === undefined ? 'Pick a time' : `Book ${clockLabel(picked)}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
