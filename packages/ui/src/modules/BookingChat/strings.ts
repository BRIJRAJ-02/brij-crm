/** BookingChat's built in copy. */
export const strings = {
  thread: 'Conversation',
  you: 'You',
  assistant: 'Assistant',
  said: (who: string) => `${who}: `,
  message: 'Message',
  placeholder: 'Tomorrow afternoon, say',
  send: 'Send',
  waiting: 'Finding times',
  times: (day: string) => `Times on ${day}`,
  suggestions: 'Suggestions',
  retry: 'Try again',
  booked: 'Booked. Opening your booking.',
} as const;
