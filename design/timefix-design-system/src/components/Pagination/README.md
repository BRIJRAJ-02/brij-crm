Pagination moves through a long list one page at a time and says where you are, as "51–100 of 1,284" with previous and next and page numbers.

**Use it for**: table footers where the total is known (companies, form responses, past bookings), and panels with `variant="compact"`. **Don't use it for**: feeds and activity, which load more as you scroll, or the virtualised record table, which scrolls.

**The consumer provides**: `page` (1-based), `pageSize`, `total`, `onPageChange`, `variant` (`full` with numbers, `compact` with the range and arrows only) and the `noun` screen readers hear after the total. `PopNumber` is exported for any number that changes in place.

**States**: first page (previous disabled), middle (first, last, current and its neighbours, gaps as "…"), last page (next disabled), current page (white raised pill with a hairline), empty ("0 of 0", both arrows disabled).

**Interaction**: every arrow and number is a tab stop; Enter or Space goes there. The range is a polite live region. When it changes, only the characters that changed rise 8px into place with a 2px blur over 500ms on the bounce curve, the last two 80ms and 160ms behind (transitions.dev 02, number pop-in); the shared leading characters stay still. Reduced motion swaps instantly.

**Replaces**: Pagination.
