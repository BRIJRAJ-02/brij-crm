# 0070 verify

Each check is run in the real app (both productions after landing) or by the named test. This file starts with slice 5; checks for slices 1 to 4 are owed.

## Slice 5. Page only people

- AC-7040: an admin adds "Nick" with no email. The handle offered is `nick`, or `nick-2` when `nick` is taken. A handle typed by hand that is taken says Taken and offers a free one.
- AC-7041: Nick appears in Members as "Page only", takes a seat, gets no email, and his page is Private. Making him Admin or Owner, alone or in a bulk change, or handing him ownership, answers 403. An email an active member uses, or an open invitation names, is refused 409.
- AC-7042: the partner's list, PUT, DELETE and launch never find Nick. A partner PUT with Nick's email is refused 409.
- AC-7043: Remove person asks first; after it `/nick` stops, his sessions end, and his content is still there for 30 days. Remove person on a member with a login answers `NOT_FOUND`.
- AC-7044: History shows "added a page for Nick at /nick" and "removed Nick and their page from Team pages".
- AC-7046: send Invite to manage their page to a fresh address; open it signed out; sign in by code at that address. The same page, handle and History open, and the "Page only" tag is gone. The same link opened again shows "Your login is ready". An address that already has a login is refused when the link is opened. A member holding `link_pages.manage_team` without `members.invite` sees no invite item, and the server refuses the call.
- AC-7047: renaming Nick and giving him a title on Team pages shows the new name on `/nick` after the cache purge. A member with a login shows Name and Title read only with "They change this in their own Profile."
- AC-7048: a team page manager uploads a cover to Nick's draft and sees it in the editor before Publish.
- AC-7022 purge: a managed person removed 31 days ago loses their page, blocks, counts and stored files at the daily cleanup. The handle is held (not claimable) for 90 days. Their member row stays, named, in History. A removed person who is still a guest here is not purged (core test).
