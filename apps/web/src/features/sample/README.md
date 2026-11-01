# Sample data

One button for owners and admins to try the CRM on a realistic set, and take it away again.

- **Empty table** (`RecordsScreen.tsx`): an empty People, Companies or Deals adds a quiet "Add sample data" beside New and Import CSV while the workspace has none. It is busy while the job runs; the job's end says "Sample data added" (`main.tsx`) and the tables read again.
- **Settings › General** (`SampleDataSection.tsx`): one row, "Try the CRM with example records", whose one button is Add sample data or Remove sample data. Remove takes exactly the sample records (and their tasks) to the trash in one action; its toast's Undo brings them back.
- What it adds: 8 companies, 15 people, 10 deals across the Sales stages, 4 notes and 4 tasks for the person, and the Sales template on Deals (its stages and a Pipeline board) where the workspace hasn't made its own. No questions are asked (owner rule: no questionnaire).
- State comes from the data layer's held copy (`data.sampleData.view`, `useSample.ts`), read again after each change and at the job's end. Every string is in `strings.ts`.
