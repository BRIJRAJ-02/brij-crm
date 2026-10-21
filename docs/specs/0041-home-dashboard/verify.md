# 0041 verify

- Sign in to a workspace with no calendar, no booking page and no form: Home shows Finish setting up with Connect your calendar first and its button; Today, Tasks due and Needs attention are absent.
- Make a task due today assigned to yourself: Tasks due shows it. Tick it: it leaves Home and is done in My tasks.
- Book yourself from a booking page for today: Today shows it under Next with its Join link.
- Make a deal with you as Owner in an open stage, then set its `updated_at` back 15 days in the database: Needs attention lists it. Move it to Won: it leaves.
- At 390px wide every card is one column with no sideways scroll; in dark mode the cards and text keep their contrast.
- Stop the API: each card shows its error with Try again.
