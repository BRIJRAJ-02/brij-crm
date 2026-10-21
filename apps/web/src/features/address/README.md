# address

A workspace's web address (spec 0036), shared by first run's Your workspace (`features/welcome`) and Settings › Workspace › General, so both offer the same addresses the same way.

- `address.ts` (pure, tested in `address.test.ts`): `SLUG_RULE` and `SLUG_MAX` (the server checks the same rule), `slugFrom` (an address from a name), `addressAsTyped` (lowercase, spaces as dashes), `companyDomain`, and `addressCandidates(name, email)`, the addresses to offer, best first.
- `useAddress(check, candidates, typed)`: the address to use, where it stands (invalid, checking, free, taken, unknown) and up to three free suggestions. `check` is `data.workspaces.slugAvailable`; each address is asked about once, 300 ms after the last key, at most six checks a change. Feed `suggestions` to Field's `suggestions`.

On a settings page, pass the typed address (or undefined for the default) and leave out the workspace's own current address from what counts as taken.
