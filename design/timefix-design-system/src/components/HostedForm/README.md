HostedForm is the form a guest fills in, on its hosted page, inside an embed and in the builder's preview, one tree for all three.

**Use it for**: any Timefix form a visitor answers, one question at a time (`mode="one"`, Typeform's way) or every question on one card (`mode="page"`, Tally's). **Don't use it for** forms inside the app: use Form and its fields at 36px.

**The consumer provides**: `title`, `description`, `questions` (each `{ id, kind, title, description?, required?, placeholder?, options? }` across fourteen kinds: short, long, email, phone, choice, multi, dropdown, rating, date, file, address, ranking, signature, booking), `onSubmit(answers)` (a rejection shows the alert and keeps the answers), `onFinishLater(answers)` resolving with a link, `booking` (open days and times for the booking step), `onUpload(file, onProgress)`, `thanks`. `QUESTION_KINDS` names and icons every kind; `checkAnswer` and `answerText` are the one checker and the one reader the builder shares.

**States**: answering, invalid (red line under the control, the control shakes), sending (the button keeps its width with a spinner), failed, saved for later, thank you.

**Interaction**: Enter goes on (Shift and Enter breaks a long answer's line); a letter key picks a choice card; a single choice, a dropdown pick or a rating goes on by itself 450ms later, never from the last question; Back returns. Steps slide side by side (transitions.dev 08, 8px and 3px blur, 250ms) in a card that eases to each step's height (01). A refused step shakes (12). Choice ticks draw (25); stars pop on the bounce curve; the dropdown and date open in the shared Popover (05). Finish later opens its Saved row as an accordion (21) and Copy link swaps to Copied. The thank you draws its check (10) and reveals its words, staggered 40ms (18), over the sent answers.

**Replaces**: HostedForm, HostedFormSteps, Question, AddressQuestion, FileQuestion, RankingQuestion, SignatureQuestion, FinishLater, FormBooking, BookingView, SentAnswers, FormParts.
