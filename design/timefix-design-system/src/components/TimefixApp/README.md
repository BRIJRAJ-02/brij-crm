TimefixApp is the whole Timefix app as one prototype, built module by module in the new design language: the sidebar from `app-ia.md` (Home, Inbox, Tasks, Notes; Records; Lists; Bookings; Forms, Link page, Insights; Settings), ⌘K over records, pages and actions, Home, and each module as it is rebuilt.

**Use it for**: reviewing the product end to end and the flows between modules. **Don't use it for** a single module's states (each module's own component and demo).

**The consumer provides**: `initial` CRM data (Northwind by default, see `data.ts`) and `start`, the page it opens on. Bookings is BookingsFlow inside it, kept mounted so its state survives moving around the app.

**States**: Home with the setup checklist, today's meetings (from Bookings), my tasks and four numbers; modules not rebuilt yet say so and lead home.
