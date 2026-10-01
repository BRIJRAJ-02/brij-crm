# 0003 · The component inventory

## Summary

This is the full list of what the library holds when #4 is done, worked out from the 56 features in the scope: the artifact's 33 component cards ported, the rest new. Each line says which features need it and what it's built on. The builder looks (formula, sequence, automation, form and assistant) are built now as presentational components, and their logic arrives with their features. A component not on this list goes through the house rule first: reuse it, add a variant, and only then add a new one, with a written reason.

**Source**:
- **Port** means it's in the artifact today, rebuilt in code to its card.
- **New** means it isn't in the artifact yet; it's designed in code and published to the artifact.
- **Variant** means it extends a listed component rather than being a new one.

**Needed by** lists scope feature numbers.

## Atoms

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| Icon | Port (done in #3) | all | Lucide registry | stories added |
| Kbd | Port | 10, 20, 33 | | platform aware keys (⌘ or Ctrl) |
| Button, SplitButton | Port | all | `Button`, `ToggleButton` | secondary, primary, ghost, dashed; md, lg; icon only; loading; pressed (toggle) |
| Badge | Port | 17, 28 | | counts |
| Tag, TagList | Port | 13, 20, 21 | | nine hues; archived option muted |
| Avatar, AvatarStack | Port | 17, 23, 26 | | person circle, company square; hue from a stable hash |
| RecordChip | Port | 15, 17, 20 | `Link` | person, company, other; member and actor chips |
| LinkChip | Port | 13, 20 | `Link` | protocol allowlist |
| StatusDot | Port | 13, 21, 43 | | |
| Rating | Port | 13 | `RadioGroup` | |
| Checkbox | Port | 20, 22 | `Checkbox` | indeterminate |
| Radio, RadioGroup | Port | 23, 25 | `RadioGroup` | |
| Switch | Port | 28, 36 | `Switch` | |
| Skeleton | Port | all | | pulse via `duration-pulse`; reduced motion is static |
| Currency | Port | 13, 52 | | code, then amount |
| Path | Port | 15, 20 | | attribute path through relations |
| Variable | Port | 45, 46 | | missing state |
| Mention | Port | 27, 29 | | |
| RemoteCursor | Port | 27 | | |
| Spinner | New | all | `ProgressBar` (indeterminate) | used by Button loading; one turn per `duration-spin` |
| ProgressBar | New | 14, 22, 30, 55 | `ProgressBar` | determinate and indeterminate |
| Meter | New | 38 | `Meter` | usage against a limit; warning and over states |
| Link | New | all | `Link` | inline text link; protocol allowlist |
| Separator | New | all | `Separator` | |
| Tooltip | New | all | `Tooltip`, `TooltipTrigger` | opens after 500 ms, at once on keyboard focus, never the only label |
| TruncatedText | New | 17, 20 | | ellipsis, full text in a tooltip only when cut |
| RelativeTime | New | 17, 19, 28 | | ticks from the provider clock; exact time in a tooltip |
| Code | New | 34, 39 | | mono `code` style, optional copy |
| FileIcon | New | 32 | Icon | by MIME type |
| VisuallyHidden | New | all | React Aria `VisuallyHidden` | |

## Molecules

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| Field | Port | all forms | `TextField`, `NumberField` | prefix, hint, counter, multiline, error, read only, disabled; search variant |
| Select | Port | 13, 20, 23 | `Select`, `ListBox` | tags, dots or people as options |
| SegmentedControl, ThemeSwitch | Port | 20, 21, 52 | `RadioGroup` | sliding indicator; ThemeSwitch in the sidebar footer reads `context.theme` |
| EmptyState | Port | all | | empty, error (with retry), locked |
| Tabs | Port | 17 | `Tabs` | icon, label, count; sliding indicator |
| Menu, MenuItem, MenuLabel, MenuSeparator | Port | all | `Menu`, `MenuTrigger`, `SubmenuTrigger` | variants: searchable (`Autocomplete`), async, virtualised, checks |
| ContextMenu | Variant of Menu | 17, 20, 21 | `Menu` | opens on right click or Shift F10 |
| Toast, ToastRegion | Port | all | `UNSTABLE_Toast` | the timing policy |
| KanbanCard, KanbanColumn | Port | 21, 51 | `GridList` | read only card; built in milestone 3 with the board |
| DatePicker | Port | 13, 19, 20 | `DatePicker`, `Calendar` | typed dates, quick picks; range variant (`DateRangePicker`) for filters and dashboards |
| FilterChip | Port | 20 | | |
| Modal | Port | all | `Modal`, `Dialog` | dialog and window variants; confirm with a danger tone; grows from the centre |
| Popover | New | all | `Popover`, `Dialog` | grows from the trigger; exit animation |
| Panel | New | 17, 28, 54 | `Modal` (non modal sheet) | side panel that slides in with `ease-drawer` |
| Callout | New | 14, 22, 34, 38 | | info, success, warning, danger; inline, not a toast |
| Card | New | 39, 40, 42, 52 | | settings card, dashboard tile frame, template card |
| Steps | New | 25, 30, 40 | | numbered steps with current, done and error |
| Disclosure | New | 13, 18, 23 | `Disclosure`, `DisclosureGroup` | collapsible sections |
| Breadcrumbs | New | 13, 17, 23 | `Breadcrumbs` | navigation trail (Path is for attributes) |
| FileDrop | New | 30, 32 | `DropZone`, `FileTrigger` | drag or browse; accepted types and size shown |
| FileItem | New | 32, 45 | | name, size, type icon, progress, remove |
| HuePicker | New | 13 | `RadioGroup` | nine hues as swatches with names |
| IconPicker | New | 13 | `Autocomplete`, the icon registry | offers only the curated `ObjectIcon` set (about 150) |
| CodeInput | New | 25 | `TextField` group | one time code, paste fills all boxes |
| DescriptionList | New | 35, 39 | | labelled values that are not attributes |
| Table | New | 23, 25, 34, 35, 42 | `Table` | small, non virtual settings lists; for records use DataGrid |
| CopyButton | Variant of Button | 34, 39 | Clipboard API | copied toast |

## The field set

One display and one editor per attribute type: text, long text, number, currency, date, timestamp, checkbox, select, status, rating, email, phone, domain, URL, location, personal name, actor reference, record reference, file and interaction, plus the computed and AI treatments. All listed in [0003-attribute-values.md](0003-attribute-values.md). Needed by 13 to 22, 30, 31, 48, 51, 52 and 55.

## Modules

**App shell and views**

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| AppShell | New | all | | sidebar, top bar, view bar, content and side panel slots |
| Sidebar, NavSection, NavItem | Port | all | `Disclosure`, `Link` | workspace switcher, Quick actions, favourites, records, lists |
| TopBar, ViewBar, Toolbar, SortChip | Port (ViewBar new) | 20, 21 | | the three bars above a view |
| DataGrid (`@crm/ui/grid`) | Port of DataTable | 10, 20, 22, 30, 36 | TanStack Virtual, our column state | [0003-data-grid.md](0003-data-grid.md) |
| Board | New | 21, 51 | KanbanColumn, KanbanCard, `useDragAndDrop` | [0003-charts-board-and-schema-map.md](0003-charts-board-and-schema-map.md) |
| FilterBuilder | Port | 20 | | and/or groups, paths through relations, operators from the field set |
| SortBuilder | New | 20 | `GridList` with reordering | |
| ViewSettings | New | 20, 21 | `GridList` with reordering | columns or card fields: show, hide, reorder |
| CommandPalette | Port | 10, 15, 33 | `Autocomplete`, `Menu` | Quick actions, Choose record, search results with highlights and kinds |
| BulkActionBar | New | 22 | Toolbar | selection count, "select all N matching", actions, progress |
| ShortcutHelp | New | 10 | Modal | lists the shortcuts in use |

**Records**

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| RecordPanel | New | 17 | Panel | floating record panel (`radius-xl`) |
| RecordHeader | New | 17, 26 | | object tile, name, actions, presence |
| AttributeList | Port | 17, 18 | the field set | grouped sections (#18) |
| ActivityFeed (timeline) | Port | 17, 19, 43, 44 | `ValueVersion` | field changes, notes, tasks, comments, emails, meetings |
| TaskList, TaskItem | New | 19 | `GridList` | done state, assignee, due date |
| MergeView | New | 31, 50 | the field set | side by side, pick each value; the conflict variant for #50 |
| DuplicateSuggestions | New | 31 | | each with its reason; "Not a duplicate" |
| ChangePreview | New | 14, 53, 54 | the field set | before and after per value; values that won't convert |

**Collaboration**

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| RichTextEditor (`@crm/ui/editor`) | New | 19, 27, 29, 45 | Tiptap 3 | [0003-rich-text-and-email.md](0003-rich-text-and-email.md) |
| NoteEditor, FormatToolbar | Port | 19, 27 | RichTextEditor | |
| CommentThread, CommentComposer | New | 29 | RichTextEditor (comment mode) | replies, resolve, anchored to a passage |
| VersionHistory | New | 27 | | versions list, preview, restore |
| PresenceBar | New | 26 | AvatarStack | viewers; field markers on edited fields |
| NotificationInbox | New | 28 | `GridList`, Panel | unread, filters, mark read |
| NotificationPreferences | New | 28 | Table, Switch | events by channel |

**Mail, calendar and files**

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| EmailComposer | Port | 45, 46 | RichTextEditor (email mode) | variables, attachments, send |
| EmailThread, EmailBody | New | 43 | sandboxed iframe | images on request |
| MeetingCard | New | 44 | | time, attendees, unknown attendees |
| FilePreview | New | 32 | Modal | images; PDFs and other files open in a new tab through #32's link |

**Data in and out**

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| ImportMapper | New | 30, 50 | DataGrid, the field set | columns to attributes, create inline, value preview, match key |
| ExportDialog | New | 30, 37 | Modal | format, scope, progress |
| ConnectionCard | New | 43, 44, 49, 50 | Card | status, last sync, errors, connect and disconnect |

**Settings, team and admin**

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| SettingsLayout | New | 13, 23, 24, 25, 34 to 39, 42 | | settings navigation, page header, sections |
| AttributeSettings, OptionsEditor | New | 13, 14, 18 | Field, HuePicker, `GridList` | type, required, unique, default; options with hue, reorder, archive |
| AccessRuleEditor | New | 24 | Table, Select | object, field and record rules per role |
| MemberInvite, RolePicker | New | 23 | Field, Select | |
| TwoFactorSetup | New | 25 | Steps, CodeInput | QR image comes from #25 |
| SecretReveal | New | 34 | Callout, Code, CopyButton | shown once |
| UsagePanel | New | 38 | Meter, Card | |
| PlanPicker | New | 42 | Card | |
| AuthLayout, SignInForm, SignUpForm, VerifyEmail, AcceptInvite, WorkspacePicker | New | 10, 23 | Card (`placement="page"`), Field, Button | `AuthLayout` is the page card's frame, not a second centred frame |
| TemplatePicker, OnboardingChecklist | New | 40 | Card, Steps | |

**Builders** (looks now; logic with their features)

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| FormulaEditor | New | 16 | Field, Variable, Menu | attribute chips and function suggestions; the language comes from #16 |
| SequenceBuilder | New | 46 | `GridList`, Card | email, task and wait steps |
| AutomationBuilder | New | 53 | Card, Select | trigger, conditions, actions, dry run results |
| FormBuilder, PublicForm | New | 48 | the field set | PublicForm also renders outside the app (its embedding is #48's) |
| AssistantPanel | New | 54 | Panel, ChangePreview | messages, proposed changes, confirm, undo |

**Visual** (`@crm/ui/charts`, `@crm/ui/schema-map`)

| Component | Source | Needed by | Built on | Notes |
|---|---|---|---|---|
| BarChart, LineChart, AreaChart, NumberTile, ChartLegend | New | 38, 52 | visx | [0003-charts-board-and-schema-map.md](0003-charts-board-and-schema-map.md) |
| Dashboard | New | 52 | Card, `useDrag` and `useDrop` | tiles in three sizes; a Move menu, and drag by handle |
| SchemaMap, ObjectNode, RelationEdge | New | 56 | React Flow 12, ELK | |

## Counts

- **Ported:** all 33 of the artifact's component cards (Icon is already done), with their parts.
- **New:** 11 atoms, 14 molecules and 58 module pieces. The module count includes parts such as TaskItem and RelationEdge.
- **Variants:** 2 (ContextMenu and CopyButton).
- **Field set:** 20 attribute types.

The milestones in [index.md](index.md) build them in this order: atoms, then molecules and fields, then modules.
