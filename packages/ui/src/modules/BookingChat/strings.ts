/** BookingChat's built in copy. */
export const strings = {
  thread: 'Conversation',
  you: 'You',
  assistant: 'Assistant',
  said: (who: string) => `${who}: `,
  message: 'Message',
  placeholder: 'When works for you?',
  send: 'Send',
  loading: 'Loading times',
  waiting: 'One moment',
  suggestions: 'Suggestions',
  retry: 'Try again',
  restart: 'Start over',
} as const;
