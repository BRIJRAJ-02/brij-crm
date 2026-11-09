BookingChat is the guest booking assistant on a public booking page: a short conversation whose offered times book in place and ends on a booked card.

**Use it for**: the booking page's Chat view, where a guest would rather say "Thursday afternoon" than scan a month. **Don't use it for** the app's own AI panel (that is AIAssist) or for comments between teammates (CommentThread).

**The consumer provides**: `host` (name, optional photo), `title` ("Discovery call · 30 min"), `lines` (oldest first; a host line may carry `days` of times and `suggestions`, and `isStreaming` while its words arrive), `isThinking` with optional `thinking` states, `booked` once it is made, `onSend(text)` for typed words and suggestions, and `onPickTime(time, day)`, which may return a promise. The page owns the conversation.

**States**: greeting with times; guest bubbles in ink at the right, host bubbles on the subtle surface at the left with the face on each run; thinking; streaming; only the last reply's times and suggestions can be pressed; a pressed time turns ink with a spinner while it books; booked shows the card and closes the box.

**Interaction**: Enter sends; Send turns ink once there is text. Tab reaches each time and suggestion; the thread takes focus to scroll. Lines rise in 6px through a small blur; the thinking line shimmers and swaps states (transitions.dev thinking states); replies resolve word by word (streaming text); times rise in 40ms apart once the reply is whole; the booked card runs the success check, then its lines reveal. All instant under reduced motion. "Powered by Timefix" sits under the card.

**Replaces**: BookingChat and BookingChatGhost.
