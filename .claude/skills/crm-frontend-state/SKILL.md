---
name: crm-frontend-state
description: House rules for client side data and state in this CRM, the project's top priority. Use it whenever you write or review frontend code that reads, writes, caches or reacts to CRM data: screens, tables, boards, record pages, forms, hooks, stores, selectors, optimistic updates, realtime patches, presence, undo, pagination or virtual scrolling. Also use it when a component "just needs to fetch one thing", because that is exactly the case these rules exist for.
---

# CRM frontend and state rules

State management is the backbone of this app. The same record shows up in a table, on a board, in a record page, in search results and in a relation chip, often at once, while 100 people edit live. If each screen keeps its own copy, those copies drift, edits flicker, and realtime becomes a pile of special cases. So there is one client data layer, and everything goes through it.

The concrete library and its API are decided in the client data spec (feature #6 in `docs/scope/foundations.md`; read the spec in `docs/specs/` once it exists). These rules hold whatever library is chosen.

## The rules, and why

1. **One copy of each record.** The data layer holds records normalised by id, so one record is one entry. Tables, boards, pages and chips read that entry through selectors. That's what makes an edit show everywhere at once.
2. **Screens never fetch.** A component asks the data layer for what it needs (a record, a view's page of rows, an object's attributes). It doesn't call the network itself. A quick one off fetch in a component is the first crack that breaks realtime, caching and access filtering. The build has a check for this.
3. **Writes are optimistic, and always go through the layer.** An edit applies to the local copy at once, is sent to the server, and is either confirmed or rolled back with a clear message. Never write to the server and then wait to show it; the app has to feel instant.
4. **Realtime patches in place.** Change events from the server name the records that changed. The layer refetches or patches just those, and every screen showing them updates with no reload. Batch incoming patches (roughly one flush per frame), so 100 people editing don't cause a render storm.
5. **Conflicts have one rule.** When two people save the same field, the last save wins, and the person whose value was replaced sees a notice. Keep it predictable. Shared notes are the exception: they use collaborative editing and merge instead.
6. **Undo is part of the layer.** The last change a person made can be undone, because the layer knows what it changed and to what.
7. **Lists are windows, not downloads.** A view of a million records loads pages around the viewport and virtualises rows. It never loads everything. Memory should stay flat while you scroll.
8. **Server state and UI state are different things.** Records, attributes, views and members belong in the data layer. Open menus, hover, a half typed draft and which tab is showing belong to the component. Don't put UI state in the global store, and don't keep server data in component state.
9. **Presentational components stay dumb.** Design system components get their data through props and know nothing about the data layer. A thin connected wrapper per module (for example, the table for an object view) joins the two. That keeps the library reusable and makes screens easy to test.
10. **Access is already applied.** The layer only ever holds what the viewer may see. Hidden fields and records are simply absent, so don't hide them again in the UI, and never fetch "everything" and filter on the client.
11. **Presence is separate.** Who is viewing and who is editing is ephemeral. It rides its own channel and never goes into the record store.

## Before you finish any frontend change

- [ ] No component fetches or stores server data on its own.
- [ ] Every edit is optimistic, with rollback and a message on refusal.
- [ ] The screen updates live when someone else changes the same record.
- [ ] Large lists are paged and virtualised.
- [ ] Design system components receive data through props only.
- [ ] The change was tried with two browsers open on the same record.

For a second opinion, ask the `state-performance-reviewer` agent. For UI rules, see `crm-design-system`.
