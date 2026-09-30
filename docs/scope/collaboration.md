# Collaboration

Working together live: presence, shared notes, notifications, and comments. See [index.md](index.md) for the house rules and the full order.

## Slice 7: Live collaboration

### 26. Presence
Know who else is here: who is looking at a view or record, and who is editing which field right now.
**Done when:** the faces of other viewers show on a view and a record; a field someone else is editing is marked; a person who leaves disappears within a few seconds; 100 people online stay inside the delivery target.
- [ ] Build it: `/develop presence`

### 27. Shared notes · needs a decision
Notes several people can write in at the same time, like a shared doc, attached to any record.
**Done when:** two or more people type in one note at once and see each other's cursors; no text is lost on a conflict or a short disconnect; earlier versions of a note can be viewed and restored.
- [ ] Design it (spec): `/architect shared notes`

### 28. Notifications · needs a decision
One place to hear about what needs you: an in app inbox, email alerts, and settings per person.
**Done when:** mentions, task assignments, and changes to records you follow reach your inbox live, and by email if you choose; each person sets what they get and how; notifications respect access; email alerts are batched so no one is flooded.
- [ ] Design it (spec): `/architect notifications`

### 29. Comments and mentions
Talk about a record where it lives.
**Done when:** a member comments on a record or on a passage of a note, replies in a thread, @mentions a teammate, and resolves the thread; comments appear live for everyone; a mention sends a notification.
- [ ] Build it: `/develop comments and mentions`
