# Port plan: Timefix design system into the app

Written 10 November 2026 (owner said "do"). Source: `design/timefix-design-system/` on `feat/design-system-v2`
(PR BRIJRAJ-02/brij-crm#4), live in the [design system artifact](https://claude.ai/artifact/KzpzW1c8binDdobPZ2HB11),
the [Bookings prototype](https://claude.ai/artifact/Bh1hskaQKszToZebiCmLKv) and
[Business](https://claude.ai/artifact/PCChBuyL18P6hfnastgq3z). Lane branch: `claude/ds-port-ff18ba`.

## The one finding that shapes the plan

The prototype is a **look**, not a library to move. Its components are thin (Button 47 lines, Select 218,
WeekCalendar 373) while their `@crm/ui` counterparts carry the product (Button 1,825 lines with eleven variants and
seven sizes, Select 2,575, WeekCalendar 2,610, DataGrid 4,755), with `strings.ts`, the provider's clock and language,
`LoadStatus`, CSP-safe styles, three-engine stories and 2,660 screenshot baselines. Copying the prototype's TSX over
them would drop behaviour every screen relies on.

So the port **restyles `@crm/ui` in place**:

- Keep every `@crm/ui` name, prop and variant callers use. Adopt the prototype's visuals (CSS) and its motion and
  micro-interactions (the transitions.dev mapping in `CONVENTIONS.md`), onto the existing CSS modules.
- Where the prototype merges several components ("replaces"), merge only when callers move in the same change, and
  delete the old one in that change. Otherwise restyle each and note the merge as later work.
- Copy prototype code only for parts that have no counterpart (marked **new** below), rebuilt to house rules:
  CSS module with `ws-` classes, `strings.ts`, README, stories, provider clock.
- Class names: the prototype's `tf-*` plain CSS never enters the repo.

## Tokens: why phase 1 is a merge, not a copy

`packages/tokens/tokens.json` is meant to be a byte-for-byte copy of the artifact. The prototype's `tokens.json`
can't be copied as is:

1. **It drops 86 names the app uses**, among them `accent-line` (57 files), `shadow-focus` (76), `duration-hover`
   (54), `ease-hover` (50), `size-column*` (52), `size-input` and `size-chip` (33 each), `surface-sunken` (29),
   `scale-press` (29), and the whole `breakpoint` family Stylelint reads. It also drops the `stroke` family.
2. **Some names keep their name but change meaning**: `focus-ring` goes from a faint halo colour (drawn with
   box-shadow beside `accent-line`) to a solid outline colour; `size-control` 26 → 36, `size-row` 34 → 44,
   `size-nav-item` 28 → 34; `heading` and `title` swap sizes (18 and 15). Taking these values blind would break
   every screen at once, before any component is restyled.

Phase 1 therefore writes a **v2 token file** that is the prototype's plus a legacy block:

- Colours, shadows, radii, the Geist families, and every new token (`canvas`, `surface-shell`, `primary`,
  `on-primary`, `*-soft`, the transitions.dev durations, easings, distances, scales, blurs) come from the prototype.
- Every name the app still uses stays, its value re-pointed onto the new palette where a role matches
  (`surface-sunken` → `surface-subtle`'s value, `accent-line` → `accent`) and kept otherwise. Each says
  "legacy: removed when <component> ports" in its usage line, so phase 2 can delete them one by one.
- Type keeps the repo's names, valued by **role** from the prototype (medium titles): `heading` 18/26 500,
  `title` 15/22 500, `note-title` 24/32 500, `body` and `body-strong` 14/20, `label` 12/16, `kbd` 11/16, `code`
  12/18, plus the new `display`, `title-lg`, `body-lg`, `caption`.
- The density and focus names (`size-control`, `size-row`, `size-nav-item`, `focus-ring`) keep their current
  values in phase 1. They flip in phase 2's first group (Button, Field, Select), together with the one focus rule.
- `src/grammar.ts` learns the `distance` and `blur` families; `breakpoint` and `stroke` stay.
- Fonts: Geist and Geist Mono (OFL, variable, Latin woff2) join `packages/tokens/fonts/`; Inter and JetBrains Mono
  leave once nothing names them. `preloadFonts()` and the shells' preload lists move with them.
- Source of truth: the merged file is published to the Timefix design system artifact first, then read back and
  synced here (`source.json` points at that artifact and its version), as `packages/tokens/AGENTS.md` asks.
- Contrast pairs in `src/contrast.ts` gain `on-primary` on `primary` and the `*-soft` grounds.

Ink primary: `Button variant="primary"` moves from `accent` to `primary`/`on-primary` in phase 2 (Button group),
not in phase 1, so blue keeps meaning "primary" until the button itself changes.

## Phases

| Phase | What | Done when |
|---|---|---|
| 0 | This plan | committed |
| 1 | Tokens v2 and Geist (above) | `tokens:check`, `pnpm check`, contrast tests green; baselines reshot in the pinned image and the baseline diff read |
| 2 | Base components, one group per commit (list below), each flipping its legacy tokens | per group: checks, light and dark shots read, `design-system-guardian` |
| 3 | Composite and booking components, then the screens `apps/web` already has | per group: checks, shots, guardian, then `ux-interaction-reviewer` for screens |

Stop for the owner after phase 1, before phase 2.

### Phase 2 groups (in order)

1. **Controls**: Button (ink primary, pills, press scale), Field + SearchField (filled inputs, the new focus),
   Select, Checkbox/Radio/Switch, flip `size-control` and `focus-ring`.
2. **Overlays**: Menu (stays-pressed trigger, tick then close), Popover, Tooltip, Modal (Dialog look), Panel (Drawer),
   Toast.
3. **Display**: Tag + StatusDot (hue text, status icons), Badge, Avatar, Kbd, Card/Shell/Stats, Callout, EmptyState,
   Steps, Progress, Skeleton and the Motion atoms.
4. **Navigation**: Tabs, SegmentedControl, Breadcrumbs, Pagination, Disclosure, flip `size-nav-item`.
5. **Pickers and inputs**: DatePicker, TimeField (new), NumberField, PhoneField, CodeInput, ChoiceChips, Slider,
   FileDrop, ColorPicker, IconPicker, ComboBox (ReferencePicker).
6. Delete every legacy token nothing names any more.

### Phase 3 groups (in order)

1. Layout: AppShell, Sidebar, SettingsLayout, AuthLayout, CommandPalette.
2. Data and records: DataGrid (flip `size-row`), Board, FilterBar, RecordHeader, RecordPanel, fields, ActivityFeed,
   CommentThread, NoteList, TaskList, NotificationList, Chart.
3. Scheduling: BookingFlow with the shared `DayTimes`, WeekCalendar, DayStrip, MeetingList, HoursEditor,
   CalendarConnections, BookingChat, EmbedPreview, GuestLook.
4. Public and business: VenuePage, MenuPage, BusinessPage, LinkPage, HostedForm, QrCode sheet, under the public
   pages' CSS budget (`apps/web/.size-limit.js`) and the owner's frozen-behaviour notes.
5. Screens in `apps/web` that exist today: bookings (meetings, pages, availability, roster, routing, calendar),
   reservations and service (host stand), menus and QR, link pages, forms. Only features the app already has; the
   prototype's extra features go to `/architect`, not this port.

## Component map

**Kind**: *same* = restyle the `@crm/ui` component of that name; *replaces* = restyle, and the prototype also merges
the components in the last column (merge only with callers moved in the same change); *new* = no counterpart, built
to house rules; *screens* = an `apps/web` screen, not a library part.

| Prototype | `@crm/ui` counterpart | Kind | Phase | Also merges |
|---|---|---|---|---|
| AIAssist | (none) | new | 3 | AI attribute marks, assistant panel |
| ActivityFeed | modules/ActivityFeed | replaces | 3 | BookingChanges |
| AppShell | modules/AppShell | replaces | 3 | Toolbar, PreviewLayout, AsideLayout |
| AttributeField | fields/ (AttributeDisplay, AttributeEditor) | same | 3 | fields/*, Rating, ListEditor |
| AttributeSettings | modules/AttributeSettings | same | 3 | — |
| AuthLayout | modules/AuthLayout | replaces | 3 | PreviewLayout (auth use) |
| Avatar | atoms/Avatar | replaces | 2 | PersonLine |
| Board | modules/Board | same | 3 | — |
| BookingChat | modules/BookingChat | replaces | 3 | BookingChatGhost |
| BookingFlow | BookingFrame, MonthTiles, SlotList, BookingDetails, BookingReceipt | replaces | 3 | MonthTilesPlain, SlotListGroups, public-booking parts |
| BookingPagePicture | modules/BookingPagePicture | replaces | 3 | LinkCard (booking pages) |
| BookingsFlow | apps/web bookings routes | screens | 3 | BookingsScreen, BookingsTabs, BookingsTopBar, PageEditor, NewPageDialog, LinksScreen, SharingPanel, ShareTimesCard, EmbedCard, OneOffLinksCard, AvailabilityScreen, TeamWeekScreen, TeamDayView |
| Breadcrumbs | molecules/Breadcrumbs | same | 2 | — |
| BusinessPage | modules/BusinessPage | replaces | 3 | BusinessGallery, BusinessMenu, BusinessHours, BusinessLocation, BusinessReserve, MenuList, PartyBand |
| Button | atoms/Button | same | 2 | — |
| CalendarConnections | CalendarList | same | 3 | — |
| Callout | molecules/Callout | replaces | 2 | CalloutBar |
| Card | molecules/Card | replaces | 2 | Stats, RecordStats, TileGrid |
| Chart | modules/Chart | replaces | 3 | BarStrip, Donut |
| Checkbox | atoms/Checkbox | replaces | 2 | Radio, Switch |
| Checklist | SetupChecklist, ReadyPanel | replaces | 2 | — |
| ChoiceChips | molecules/ChoiceChips | replaces | 2 | GuestChips (picking) |
| Code | atoms/Code | same | 2 | — |
| CodeInput | molecules/CodeInput | replaces | 2 | VerifyEmail code input |
| ColorPicker | HuePicker, AccentPicker | same | 2 | — |
| ComboBox | fields ReferencePicker | same | 2 | RecordReferenceEditor, SuggestionList |
| CommandPalette | modules/CommandPalette | replaces | 3 | ShortcutHelp |
| CommentThread | modules/CommentThread | replaces | 3 | CommentComposer |
| DataGrid | modules/DataGrid | replaces | 3 | Table, SampleTable |
| DatePicker | molecules/DatePicker | replaces | 2 | DateNav, DateEditor, TimestampEditor |
| DayStrip | modules/DayStrip | same | 3 | — |
| DescriptionList | molecules/DescriptionList | replaces | 2 | AttributeList |
| Dialog | Modal | same | 2 | ModalTrigger, ConfirmDialog, the confirm patterns, InviteDialog |
| Disclosure | molecules/Disclosure | same | 2 | — |
| DragHandle | atoms/DragHandle | same | 2 | — |
| Drawer | Panel, ItemSheet | same | 2 | AsideLayout sheet, RecordPanel shell, QrSheet shell |
| EmbedPreview | modules/EmbedPreview | replaces | 3 | embed tiles, EmbedSnippet |
| EmptyState | molecules/EmptyState | replaces | 2 | SpotIllustration, AvatarEmpty |
| Field | molecules/Field | replaces | 2 | FieldLabel, FieldError, FieldGroup, Form |
| FileDrop | molecules/FileDrop | replaces | 2 | FileItem, FileIcon |
| FilterBar | FilterChip, FilterBuilder, SortBuilder, ViewSettings | replaces | 3 | ConditionRow |
| FloatingBar | molecules/FloatingBar | replaces | 2 | BulkActionBar, SaveBar, PublishBar, VisitorBar |
| FormPicture | modules/FormPicture | replaces | 3 | HostedFormPreview, FormLayoutThumbnail, forms list LinkCard picture |
| FormulaEditor | modules/FormulaEditor | same | 3 | — |
| GuestLook | modules/GuestLook | replaces | 3 | MenuLookThumbnail, look presets |
| HostedForm | public-form/ | same | 3 | HostedFormSteps, Question, AddressQuestion, FileQuestion, RankingQuestion, SignatureQuestion, FinishLater, FormBooking, BookingView, SentAnswers, FormParts |
| HoursEditor | modules/HoursEditor | replaces | 3 | RulesEditor |
| Icon | atoms/Icon | replaces | 2 | ProviderMark |
| IconPicker | molecules/IconPicker | same | 2 | — |
| InviteRows | modules/InviteRows | same | 3 | — |
| Kbd | atoms/Kbd | same | 2 | — |
| Link | atoms/Link | same | 2 | — |
| LinkEditor | apps/web link page editor | screens | 3 | LinkListRowOrder, link page block rows, link page phone preview |
| LinkList | modules/LinkList | replaces | 3 | LinkGrid, LinkCard, SpanCard, LinkCardSkeleton |
| LinkPage | modules/LinkPage | replaces | 3 | PageColumn, LinkPageTile, public link page parts |
| Logo | apps/web brand.ts, ProviderMark | new | 2 | ProductLogo (apps/web/src/brand.ts), SiteLogo (marketing) |
| MeetingList | MeetingCard, BookingList | replaces | 3 | — |
| Menu | molecules/Menu | replaces | 2 | ContextMenu, RowActionsMenu, ColumnHeaderMenu |
| MenuPage | MenuList, ItemSheet (public-menu) | replaces | 3 | PicksSheet |
| Motion | NumberPop, TextSwap, SuccessCheck, Spinner, Skeleton, Reveal | same | 2 | MotionDemos, TextMorph, SoftText, DropIn, Collapse, IconSwap, ShimmerText, ThinkingLine |
| NoteList | modules/NoteList | same | 3 | — |
| NotificationList | modules/NotificationList | same | 3 | — |
| NumberField | fields Number, Currency | same | 2 | NumberEditor, CurrencyEditor, NumberPop |
| Onboarding | WorkspacePreview | replaces | 3 | onboarding screens (first run) |
| OptionsEditor | modules/OptionsEditor | same | 3 | — |
| Pagination | molecules/Pagination | same | 2 | — |
| PhoneField | molecules/PhoneField | replaces | 2 | CountryPicker (dialing list), PhoneEditor |
| PhotoCrop | modules/PhotoCrop | replaces | 3 | usePhotoCrop |
| Popover | molecules/Popover | replaces | 2 | InfoTip |
| Presence | RemoteCursor | same | 3 | — |
| Progress | ProgressBar, Meter | same | 2 | — |
| QrCode | atoms/QrCode | replaces | 2 | QrSheet's code |
| QuestionList | modules/QuestionList | replaces | 3 | QuestionEditor shell, OptionsEditor (form choices), question type menu |
| RecordChip | atoms/RecordChip | replaces | 2 | LinkChip, Mention, Variable, RecordChipList |
| RecordHeader | modules/RecordHeader | same | 3 | — |
| RecordPanel | modules/RecordPanel | replaces | 3 | RecordLayout (side), RelatedRecords |
| RelationshipSettings | modules/RelationshipSettings | same | 3 | — |
| RichTextEditor | editor/ | same | 3 | FormatToolbar, MentionView, NoteEditor, SuggestionList (editor menus), slash-commands |
| RolePowers | modules/RolePowers | same | 3 | — |
| SearchField | Field (search) | new | 2 | Field (search variant), Toolbar search, CommandPalette trigger |
| SegmentedControl | molecules/SegmentedControl | replaces | 2 | ViewSwitcher |
| Select | molecules/Select | replaces | 2 | CurrencyPicker, CountryPicker, SelectEditor, StatusEditor |
| Sentence | molecules/Sentence | replaces | 2 | ConditionRow |
| SettingsLayout | modules/SettingsLayout | replaces | 3 | SectionBar, SectionList |
| Sidebar | modules/Sidebar | replaces | 3 | CustomiseSidebar |
| SignInForm | modules/SignInForm | replaces | 3 | VerifyEmail |
| Slider | atoms/Slider | same | 2 | — |
| SocialLinks | molecules/SocialLinks | replaces | 3 | SocialLinksEditor, ProviderMark social marks |
| Steps | molecules/Steps | replaces | 2 | Stepper, HostedFormSteps |
| Tabs | molecules/Tabs | replaces | 2 | SectionTabs |
| Tag | atoms/Tag | replaces | 2 | Badge, StatusDot |
| TaskList | modules/TaskList | same | 3 | — |
| TeamList | modules/TeamList | same | 3 | — |
| Text | TruncatedText, RelativeTime, Separator, VisuallyHidden, Path | same | 2 | — |
| TimeField | HoursEditor time inputs | new | 2 | TimeInput |
| Toast | provider toasts, ToastRegion | same | 2 | createToasts, useToasts |
| Tooltip | atoms/Tooltip | same | 2 | — |
| VenuePage | BusinessPage (public) | replaces | 3 | BusinessPublicPage, VenueHeader, ServiceMenu |
| WeekCalendar | modules/WeekCalendar | replaces | 3 | TeamWeek, TeamDay, MatchCalendar, MovableBlock |

## Risks

- **Screenshots.** 2,660 baselines; phase 1 changes nearly all of them (font, palette, radii). Reshoot only in the
  pinned image on this tree, diff the baseline folder, and look at a sample in both themes. Never borrow baselines.
  The run is heavy: one engine at a time, under the load gate.
- **The stories leak** (`docs/handover/features-state.md`): Firefox stories time out on main and a library push can't
  deploy until a push without a library delta. Expect it on the integration car, not this lane.
- **Density.** Controls 26 → 36 and rows 34 → 44 change every dense screen (grids, boards, settings). Flipped once per
  group so the shots can be read, never all at once.
- **Public pages' budgets.** The booking page and hosted form have a CSS and first-load budget; Geist must be
  preloaded by built name and the packs (`packs.css`) stay as they are.
- **Contrast.** `text-tertiary` and the `*-soft` grounds are new pairs; the contrast test must cover them.
- **Brand marks** are never redrawn: the prototype's `Logo` uses the existing Timefix mark files.
- **Spec drift.** Specs 0002 and 0003 describe the Attio-derived tokens; lanes never edit specs, so the changes are
  noted for `/architect` in this file.

## For /architect

- Spec 0002: the token source moves to the Timefix design system artifact; grammar gains `distance` and `blur`; type
  roles revalued; Geist replaces Inter.
- Spec 0003: the motion vocabulary is transitions.dev's; the old `duration-*`, `ease-hover`, `scale-press` names
  retire as components port. House exception kept or changed: the prototype presses at `scale-medium` (0.97), the
  house rule says no press scale (`--scale-press` stays 1). **Owner call needed before phase 2's Button group.**
