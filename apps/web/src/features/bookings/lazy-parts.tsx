// Bookings' parts that only draw once asked for (load time, bookings redesign step 1): the month to jump to a date
// (React Aria's calendar and its dates, about 49 kB), New meeting, New page, Time off, both Reassign dialogs and Link
// to a record (the field set's record picker, which brings every field editor and their schemas). Each
// loads apart from Calendar's and List's first paint: on the browser's first idle moment after it (`usePreloadParts`),
// or at once when opened first. Those mounted for their whole life with `isOpen`, so their exit plays, mount their
// code only once first opened. The props are each part's own; the names stay theirs, so a screen swaps one import.
import type { MonthCalendarProps } from '@crm/ui';
import { lazy, Suspense, useEffect, useState, type ComponentType, type LazyExoticComponent } from 'react';
import type { NewPageDialogProps } from '../booking/NewPageDialog.tsx';
import type { TimeOffDialogProps } from '../booking/TimeOffDialog.tsx';
import type { AwayReassignDialogProps } from './AwayReassignDialog.tsx';
import type { LinkRecordDialogProps } from './LinkRecordDialog.tsx';
import type { NewMeetingDialogProps } from './NewMeetingDialog.tsx';
import type { ReassignDialogProps } from './ReassignDialog.tsx';

const loadMonth = () => import('./month-calendar.ts');
const loadNewMeeting = () => import('./NewMeetingDialog.tsx');
const loadNewPage = () => import('../booking/NewPageDialog.tsx');
const loadTimeOff = () => import('../booking/TimeOffDialog.tsx');
const loadReassign = () => import('./ReassignDialog.tsx');
const loadAwayReassign = () => import('./AwayReassignDialog.tsx');
const loadLinkRecord = () => import('./LinkRecordDialog.tsx');

const LazyMonth = lazy(() => loadMonth().then((module) => ({ default: module.MonthCalendar })));
const LazyNewMeeting = lazy(() => loadNewMeeting().then((module) => ({ default: module.NewMeetingDialog })));
const LazyNewPage = lazy(() => loadNewPage().then((module) => ({ default: module.NewPageDialog })));
const LazyTimeOff = lazy(() => loadTimeOff().then((module) => ({ default: module.TimeOffDialog })));
const LazyReassign = lazy(() => loadReassign().then((module) => ({ default: module.ReassignDialog })));
const LazyAwayReassign = lazy(() => loadAwayReassign().then((module) => ({ default: module.AwayReassignDialog })));
const LazyLinkRecord = lazy(() => loadLinkRecord().then((module) => ({ default: module.LinkRecordDialog })));

/** Draws `Part` once its code is in; nothing until then (a press that opened it waits a moment for it). */
function suspended<P extends object>(Part: LazyExoticComponent<ComponentType<P>>) {
  return function Suspended(props: P) {
    return (
      <Suspense fallback={null}>
        <Part {...props} />
      </Suspense>
    );
  };
}

/**
 * Like `suspended`, for a dialog kept mounted with `isOpen` so its exit plays: nothing, and no code, until it first
 * opens; then it stays, as the dialog itself always did.
 */
function onceOpened<P extends { readonly isOpen: boolean }>(Part: LazyExoticComponent<ComponentType<P>>) {
  const Drawn = suspended(Part);
  return function OnceOpened(props: P) {
    const [hasOpened, setHasOpened] = useState(props.isOpen);
    if (props.isOpen && !hasOpened) setHasOpened(true);
    return hasOpened ? <Drawn {...props} /> : null;
  };
}

/** The jump to date month (`MonthCalendar`), loaded apart. */
export const MonthCalendar: ComponentType<MonthCalendarProps> = suspended(LazyMonth);
/** New meeting, loaded apart; mounted only while asked for. */
export const NewMeetingDialog: ComponentType<NewMeetingDialogProps> = suspended(LazyNewMeeting);
/** Reassign, loaded apart; mounted only while asked for. */
export const ReassignDialog: ComponentType<ReassignDialogProps> = suspended(LazyReassign);
/** Reassign for a host away, loaded apart; mounted only while asked for. */
export const AwayReassignDialog: ComponentType<AwayReassignDialogProps> = suspended(LazyAwayReassign);
/** Link to a record, loaded apart; mounted from its opening, kept while it closes (BookingDialog holds it). */
export const LinkRecordDialog: ComponentType<LinkRecordDialogProps> = suspended(LazyLinkRecord);
/** New page, loaded apart and drawn from its first opening on. */
export const NewPageDialog: ComponentType<NewPageDialogProps> = onceOpened(LazyNewPage);
/** Time off, loaded apart and drawn from its first opening on. */
export const TimeOffDialog: ComponentType<TimeOffDialogProps> = onceOpened(LazyTimeOff);

/** Loads every part above once the browser is idle after the page drew, so a first press rarely waits on its code. */
export function usePreloadParts(): void {
  useEffect(() => {
    const start = () => {
      for (const load of [
        loadMonth,
        loadNewMeeting,
        loadNewPage,
        loadTimeOff,
        loadReassign,
        loadAwayReassign,
        loadLinkRecord,
      ]) {
        void load().catch(() => undefined);
      }
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(start, { timeout: 5_000 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    const timer = window.setTimeout(start, 2_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, []);
}
