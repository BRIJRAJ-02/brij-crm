The settings layout pairs a grey icon list of settings pages with section cards that span the content area (full width, like every app page), each a title, a grey one-liner, rows with their control on the right, and a footer with a note and Save.

**Use it for**: every page under Settings (Profile, General, Members, Calendars, Billing) inside the app shell's surface. **Don't use it for**: per-record or per-view options (use a popover or the aside panel).

**The consumer provides**: `SettingsLayout` (`title`, grey `description`, `nav`, sections); `SettingsNav` (`groups` of `id`, `label`, 16px `icon`, `href`; `current`; `onNavigate`); `SettingsSection` (`title`, `description`, a status `Tag`, `footnote`, an ink `action` such as Save, `tone="danger"` for the danger zone); `SettingsRow` (`title`, grey `description`, `control`, optional `icon` in a grey well); `SettingsField` is a stand-in text field until the shared one lands.

**States**: nav item rest, hover, current (soft grey pill); Save disabled until something changes, then pending, then "Saved" with a tick; the danger section has a red-tinted edge and footer.

**Interaction**: switches and segmented controls take effect at once and have no Save; fields save with their section's Save. Destructive rows open a confirm first; reversible ones prefer Undo. "Show advanced settings" uses the accordion motion (transitions.dev 21), the Save label crossfades (04 via `TextSwap`), and the nav washes on hover over 150ms.

**Replaces**: SettingsLayout, SectionBar, SectionList.
