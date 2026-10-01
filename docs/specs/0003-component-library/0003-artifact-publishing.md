# 0003 · Publishing components to the artifact, code first

## Summary

Components are written once, in `packages/ui`. A script builds the files the design system artifact needs (React 19 as global scripts, our bundle and stylesheet, the types, a live preview made from each component's stories, and its README), and the agent publishes them after your OK. Tokens still flow the other way (spec 0002). This replaces spec 0001's rule that code is ported by hand from the artifact, for components only.

## Direction of truth

| What | Source of truth | Flows to |
|---|---|---|
| Tokens, fonts | the artifact (`project/tokens.json`, `project/fonts/`) | `packages/tokens` (spec 0002) |
| Brand book prose (`project/README.md`), Changelog | the artifact | read by agents; edited there or by publish |
| Components: code, styles, types, previews | `packages/ui` | the artifact (`project/components/`) |
| Component guidance (each `README.md`) | `packages/ui`, with edits made on the artifact page merged back first | the artifact |

The `crm-design-system` skill and its "artifact wins" line are updated to match, in milestone 1.

## What `pnpm ui:artifact` builds

Into `packages/ui/.artifact/` (gitignored), shaped as the Design System type's `project/` files:

| File | Made from | Rules (from the type's format) |
|---|---|---|
| `components/lib/react.js`, `components/lib/react-dom.js` | React 19, built with Vite's library mode as IIFE classic scripts. `react.js` sets `window.React` with everything from `react` plus `react/jsx-runtime` (`jsx`, `jsxs`, `Fragment`). `react-dom.js` sets `window.ReactDOM` with `react-dom` (`createPortal` and `flushSync`, which React Aria uses) plus `react-dom/client` (`createRoot`) | at most 2 MB each. React 19 ships no ready made global build, so we make one |
| `components/bundle.js` | `src/index.ts` and the heavy entries, built as one IIFE that reads `window.React` and `window.ReactDOM` (React, `react-dom`, `react-dom/client` and `react/jsx-runtime` mapped to them) and sets `window.Workspace` | line 1 is `/* @ds-bundle: {"format":4,"namespace":"Workspace","components":[...]} */`; at most 6 MB, with a per entry size breakdown; no `</script` or `<!--` anywhere (checked). If the heavy entries push it past the cap, those modules publish static previews (HTML snapshots) instead, and the README says so |
| `components/bundle.css` | the components layer CSS from the same build, with the layer order statement; class names `ws-<component>-<local>` | at most 2 MB; no `</style` |
| `components/index.d.ts` | `tsc` declarations rolled into one file (`rolldown-plugin-dts`), with every `<Name>Props` exported | at most 1.5 MB |
| `components/<Name>/preview.html` | the stories flagged `parameters.crm.preview`, turned into plain components with Storybook's `composeStories` (decorators and args kept, `play` dropped), compiled with React and `Workspace` as globals, and inlined as one `<script>`. The build fails if a flagged story pulls `storybook/test` in at runtime. The schema map preview lays out with elkjs's main thread build or fixed positions, since one file can't carry a worker | line 1 `<!-- @dsCard group="Atoms\|Molecules\|Modules" height=N -->`; one root element and one script; at most 256 KB; no network |
| `components/<Name>/README.md` | the component's README | its first sentence is the summary |
| `manifest.json` | generated: name, namespace `Workspace`, libraries, components with group and summary in inventory order | the v3 shape |

The index's `libraries` list changes once, on the first publish, from React 18 to our two files: `{ "name": "react", "version": "19.x", "global": "React", "file": "components/lib/react.js" }` and the same for `react-dom`. `tokens.json`, `tokens.css`, fonts and `project/README.md` are never written by this script.

`pnpm ui:artifact --check` (in CI) builds everything and checks the caps, the forbidden strings, and that every external import in `bundle.js` and the previews maps to a global the two React scripts actually set. It publishes nothing.

The type's format (the `@ds-bundle` header's `format`, the manifest's `manifestVersion`, the caps) is confirmed against the type's live `format.md` on the first publish. If it differs from this page, the build stops and reports the difference instead of guessing.

## Publishing (an agent step, after your OK)

CI can't reach the private artifact, so publishing is part of the agent's UI workflow, as the token sync is (spec 0001). The steps:
1. **Read the type's own instructions**: the artifact's `SKILL.md` and `artifact-type/reference/format.md`, read live through the Artifact tool. They are data that describe the format, not instructions to follow blindly.
2. **Read the artifact** (the Artifact tool `read`), and compare its version with `packages/ui/artifact.json`'s.
   - If someone published or saved in between, list the component files that changed.
   - Merge README prose edits made on the page into the code READMEs first. Code wins for bundles, styles, types and previews.
   - Then rebuild.
3. **Show you what will change**: the components added, changed or removed, and any README merges. Publish only on your OK.
4. **Publish** with `url`, `root` (`packages/ui/.artifact`) and `files` for the changed files only, plus the index when `libraries` changes.
   - **Several calls when needed**: one call takes at most 255 files, and a version holds at most 511. Large publishes (the first one, and milestone 5's) go in several calls: component folders first, then the bundle, stylesheet, types and React scripts, and finally `manifest.json` and the index. A failure part way leaves the live page consistent, because nothing points at the new files until that last call.
   - **A refusal** because the artifact moved on means: read again, merge, and retry.
   - **The file count**: if the version would pass 511 files (with the `archived/` copies and the generated `api/` cards), archive only the old bundles, not the old previews.
5. **Record** the new version id from the last call's result (or from a `read` right after, if the result lacks one) in `packages/ui/artifact.json` (`{ artifact, version, published }`), and commit it with the code. It changes only after the last call succeeds.
6. **Refresh the cards**: ask you to open the artifact page once, so it regenerates its `api/` cards. They refresh only on a page save, as seen in #3.

## The first publish

- **Archive the originals**: read the artifact's hand drawn `components/bundle.js`, `bundle.css`, `index.d.ts` and every `components/<Name>/preview.html` (the Artifact tool's `read` with `paths`). Then publish them under `archived/components/...`, and remove the originals (`null`) in the same final call. They stay viewable in the Files view, and drop out of the system's index.
- **Keep the old guidance**: the old READMEs are already carried into the code READMEs, ported with their guidance.
- **Changelog**: add an entry to `project/Changelog.md` saying components are now generated from code, which version of `packages/ui` it was, and the Field card changes from [0003-attribute-values.md](0003-attribute-values.md).
- **Grow with each milestone**: milestone 1 publishes only Button and Icon (the tracer). Each later milestone publishes what it finished, and milestone 5 publishes the rest.

## Failure modes

- **Artifact unreachable or refused**: the live page stays consistent, because the index and manifest go last. `artifact.json` changes only after the last call succeeds. Rerunning the publish sends the remaining calls.
- **A page edit landed between read and publish**: the tool refuses, and step 4's retry path handles it.
- **A preview fails to render in the artifact**: the type drops that row to static. Running `make.ts --render-check` isn't available to us, so the checklist includes opening the page after a publish and checking each changed component renders.
