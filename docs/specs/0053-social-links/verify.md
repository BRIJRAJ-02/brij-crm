# 0053. Social links: how to check it

Run with an account that has a handle, a personal booking page and a team page.

| Criterion | Walk | Result |
|---|---|---|
| AC-5301, AC-5302 | Settings › Profile › Social links: add LinkedIn by handle, X by a pasted link with a tracking tail, and a website; move one up; save. Reload: the order and the canonical links are kept. An empty row left empty is dropped, not refused | |
| AC-5303 | Give the Instagram row a LinkedIn link: it is refused with "That's a link to LinkedIn, not Instagram." Give the website row a link on a known network: it is refused. A website with credentials in it is refused | |
| AC-5304 | The booking page editor shows the Social links card to the page's owner, with the switch on. Edit social links opens the Modal, saves at once, and shows the change at once. Stop the api and save: the old set comes back with Try again. Close with changes: it asks "Discard your changes?" A colleague sees the switch read only with the reason; a team page says why it shows none | |
| AC-5305 | The personal booking page shows the row in the host rail on a wide screen and in the stacked header on a phone, and on the details step. The receipt, the guest page, the hosted form and team pages show none. `/<handle>` shows the row under the bio | |
| AC-5306 | Each icon is a link that opens in a new tab, has a hit area of at least 32px, reads as "LinkedIn, ada" to a screen reader, and shows "LinkedIn · ada" on hover and on focus | |
| AC-5307 | `curl` the public booking page read and `GET /api/public/handles/<handle>`: both answer `socials` with a `network`, an `href` and a `label`, and the team page answers none | |
| AC-5308 | Change the set, then open the person's history: one `member.profile_updated` entry with the field `socials`, reading "changed their social links", with the links before and after. Flip the page switch: no audit row, and `updated_by` changes | |
| AC-5309 | `pnpm --filter @crm/db test guards social`: a direct select as `crm_app` is refused, both functions are owned by `crm_handle` with a fixed `search_path`, and two saves at once leave one whole set | |
| AC-5310 | `pnpm size`: the booking page's first load is unchanged; the Settings section and the editor card load on demand | |
