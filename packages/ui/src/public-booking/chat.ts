// `@crm/ui/public-booking/chat`: the booking page's chat on its own (spec
// 0041), so the page loads it only when the visitor first chooses Chat.
export {
  BookingChat,
  type BookingChatHost,
  type BookingChatCard,
  type BookingChatDay,
  type BookingChatError,
  type BookingChatLine,
} from '../modules/BookingChat/BookingChat.tsx';
/** The page's own questions in chat (4 Nov 2026): which show, their chips, and a reply checked as an answer. */
export {
  chatAnswerOf,
  chatChipsOf,
  chatQuestions,
  type ChatAnswer,
  type ChatAnswerWords,
} from '../modules/BookingChat/questions.ts';
