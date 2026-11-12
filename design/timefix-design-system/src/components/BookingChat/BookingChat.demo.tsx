import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { BookingChat, type BookingChatBooked, type BookingChatDay, type BookingChatLine } from './BookingChat.tsx';

const t = (day: string, labels: string[]): BookingChatDay => ({ day, times: labels.map((label) => ({ id: `${day}-${label}`, label })) });
const greeting: BookingChatLine = {
  id: 'hello', role: 'host',
  text: "Hi, I'm Priya's booking assistant. Pick a time below, or tell me what suits you.",
  days: [t('Tue 11 Nov', ['9:30 AM', '11:00 AM', '2:00 PM']), t('Wed 12 Nov', ['10:00 AM', '4:30 PM'])],
  suggestions: ['Something on Thursday', 'Next week'],
};
const replies: Record<string, Pick<BookingChatLine, 'text' | 'days' | 'suggestions'>> = {
  thursday: { text: 'Thursday afternoon has two open times. Tap one and it is yours.', days: [t('Thu 13 Nov', ['2:30 PM', '3:30 PM'])], suggestions: ['Next week'] },
  week: { text: 'Next week is open most mornings. Here are the earliest ones.', days: [t('Mon 17 Nov', ['9:00 AM', '10:30 AM']), t('Tue 18 Nov', ['9:30 AM'])], suggestions: ['Something on Thursday'] },
};

export function BookingChatDemo() {
  const [lines, setLines] = useState<ReadonlyArray<BookingChatLine>>([greeting]);
  const [thinking, setThinking] = useState(false);
  const [booked, setBooked] = useState<BookingChatBooked>();
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  const reply = (text: string) => {
    const r = /week/i.test(text) ? replies.week : replies.thursday;
    if (!r) return;
    const id = `r${Date.now()}`;
    const words = r.text.split(' ');
    setThinking(true);
    later(() => {
      setThinking(false);
      words.forEach((_, n) => later(() => setLines((ls) => {
        const line: BookingChatLine = { id, role: 'host', text: words.slice(0, n + 1).join(' '), isStreaming: n < words.length - 1, days: r.days, suggestions: r.suggestions };
        return ls.some((l) => l.id === id) ? ls.map((l) => (l.id === id ? line : l)) : [...ls, line];
      }), n * 60));
    }, 1600);
  };
  const send = (text: string) => { setLines((ls) => [...ls, { id: `g${Date.now()}`, role: 'guest', text }]); reply(text); };
  const pickTime = (time: { label: string }, day: string) => new Promise<void>((resolve) => {
    later(() => {
      setLines((ls) => [...ls, { id: `g${Date.now()}`, role: 'guest', text: `${day} at ${time.label}` }]);
      setBooked({ title: 'Discovery call with Priya Raman', when: `${day}, ${time.label} (30 min)`, where: 'Google Meet', email: 'sam@northwind.com' });
      resolve();
    }, 900);
  });
  const restart = () => { timers.current.forEach((id) => window.clearTimeout(id)); setThinking(false); setBooked(undefined); setLines([greeting]); };

  return (
    <div className="tf-demo tf-demo--canvas tf-stack">
      <BookingChat host={{ name: 'Priya Raman' }} title="Discovery call · 30 min" lines={lines} isThinking={thinking} booked={booked} onSend={send} onPickTime={pickTime} />
      <span className="tf-row"><Button size="sm" variant="ghost" onPress={restart}>Start over</Button></span>
    </div>
  );
}
