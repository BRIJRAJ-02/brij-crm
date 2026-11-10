/** Calendar helpers for a booked time: an .ics file (Apple, and any calendar), and Google and Outlook add links. */
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** An .ics file for the guest's own calendar. */
export function icsFor(title: string, where: string, start: Date, minutes: number): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Timefix//Bookings//EN', 'BEGIN:VEVENT', `UID:${start.getTime()}@timefix.com`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime() + minutes * 60_000))}`, `SUMMARY:${title}`, `LOCATION:${where}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/** Google Calendar's "add event" page, filled in. */
export const googleCalendarUrl = (title: string, where: string, start: Date, minutes: number) =>
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${stamp(start)}/${stamp(new Date(start.getTime() + minutes * 60_000))}&location=${encodeURIComponent(where)}`;

/** Outlook on the web's "add event" page, filled in. */
export const outlookCalendarUrl = (title: string, where: string, start: Date, minutes: number) =>
  `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(title)}&startdt=${encodeURIComponent(start.toISOString())}&enddt=${encodeURIComponent(new Date(start.getTime() + minutes * 60_000).toISOString())}&location=${encodeURIComponent(where)}`;
