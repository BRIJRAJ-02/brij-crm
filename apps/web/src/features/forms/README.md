# Forms

Captures, Forms (spec 0023, `0023-experience.md`): forms that make a person from every enquiry. The routes are `/w/$slug/captures/forms` (the list) and `/w/$slug/captures/forms/$formId` (the editor); the Captures frame and its Links · Forms tabs come from the shell.

## Screens

- **The list** (`FormsScreen.tsx`): one Card per form, with its enquiries this month, spam and last enquiry as Badges, the Accepting switch (pause and resume), and a menu (Open, Copy the address, Duplicate, Delete, which names the submissions that go with it). New form makes "Untitled form" at once and opens it.
- **The editor** (`FormEditor.tsx`): the TopBar holds the name with its status beside it (EditorStatus), Preview (the draft in a new tab, marked Preview, not live), Publish (only while there is something to publish) and the menu. The name changes in Settings, as a record's name changes in its fields, not from the header. PreviewLayout, the one Captures editor layout it shares with the booking page editor, holds the tabs once published (Form · Settings · Install · Submissions), notices (a read only note, a refused publish, a teammate's change), and the live preview with Colour and Corners. The draft saves itself a second after the last change; a teammate's save first shows "Bea changed this form. Load their version".
- **Questions** (`QuestionsSection.tsx`): QuestionList cards, closed until opened, with Add a question, presets, Close all, Duplicate, Delete with Undo, and reorder by handle or keyboard.
- **The first publish** (`PublishDialog.tsx`): Step 1 of 2, name and address (checked as typed); step 2, the object and each question's Where it goes, prefilled by label, or Build one out of this form for `schema.manage`; then Your form is live.
- **Settings, Install, Submissions** (`SettingsTab.tsx`, `InstallTab.tsx`, `SubmissionsTab.tsx`).

## Rules

- `draft.ts` holds every change to a draft as a plain function; `draft.test.ts` checks them.
- The publish check is `publishProblem` from `@crm/data/forms`, the server's own.
- The visitor's page is `src/public/main.ts`, drawn by `@crm/ui/public-form` with no React (about 12 kB gzipped).
