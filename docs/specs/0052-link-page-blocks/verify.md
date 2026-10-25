# 0052. More blocks: how to check it

Run with a test account that has a handle, a link page with a few blocks on it already, and at least one published hosted form.

| Criterion | Walk | Result |
|---|---|---|
| AC-5201, AC-5204 | Each new kind appears in the one Add item modal's radio group with its icon and its line, and is added, edited, placed in a section, hidden and deleted exactly as a link is. No kind opens a screen of its own | |
| AC-5202 | Write a row straight into `auth.profile_items` through a definer with a kind no build knows: `/<handle>` draws every other block and the editor lists every other row, neither fails | |
| AC-5203 | A FAQ with 10 questions and 600 character answers saves; a `data` object past 16 KB is refused | |
| AC-5205, AC-5206 | Add a text block with a title and four lines: the page draws the title as a small heading and the body under it with its line breaks, in the reading measure, with no border and nothing to press. A 1,001 character body is refused naming the limit | |
| AC-5207, AC-5211, AC-5220 | A text block, a FAQ and a testimonial show no press chip in the editor, and pressing or opening them writes no row in `auth.profile_item_presses` | |
| AC-5208, AC-5212, AC-5218, AC-5219 | The 6th text block, the 3rd FAQ, the 11th question, the 4th form block and the 7th testimonial are each refused with `LIMIT_REACHED` and a sentence naming the limit, and the Add modal disables that kind with the same sentence | |
| AC-5209 | A FAQ with the same question twice, differing only in case and spaces, is refused with "You already asked that one." | |
| AC-5210 | On `/<handle>` every FAQ question starts closed, opens from the keyboard, carries `aria-expanded`, and opening one moves nothing above it. Checked with a screen reader for the question and answer pairing | |
| AC-5213, AC-5214 | Add a form block: `auth.profile_items` holds its `workspace_id` and `form_id` as columns, and `data` holds the label only. Unpublish the form: the block leaves `/<handle>` and stays in the editor. Publish it again: it comes back in its old place | |
| AC-5215, AC-5216 | The form row shows the form's name and description and opens `/f/:key` in the same tab, and the press is counted and shows in the editor's chip | |
| AC-5217 | Add › Email signup: the modal names the workspace the form will be made in and says where the addresses will go, then makes a one field form and places a block for it. An address submitted on the page lands in that form's responses, and the form's routing and notifications fire as they do for any other form | |
| AC-5222 | `curl -i https://<public origin>/<handle>` and `curl -i /b/:key`: the `Content-Security-Policy` header is byte for byte what it was before this spec, with no `frame-src` on `/<handle>`. `git diff` on `apps/web/vercel.json` across the whole slice is empty | |
| AC-5223 | No block issues a request to any origin but ours: open `/<handle>` with every block kind on it and read the network panel | |
| AC-5224 | A body of `<script>alert(1)</script>` reads as those characters on the page and is stored as those characters; a body with U+2028 in it is refused | |
| AC-5225, AC-5226 | `pnpm --filter @crm/db test guards profile`: `crm_app` still cannot select from `auth.profile_items`, and `form_id` is reachable only through the `crm_handle` definers. The public answer for a form block holds no workspace id, no form id and no field list | |
| AC-5227 | `pnpm size`: `/<handle>`'s first load is up by at most 3 kB gzipped over the commit before the slice | |
| AC-5228 | With more than eight rows, the search finds a text block by its title and a FAQ by one of its questions, and does not find a text block by a word that appears only in its body | |
| AC-5229 | Type a FAQ question in the editor: the preview beside the list shows it before anything is saved | |
