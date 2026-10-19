# 0026 · The settings area

**Status**: Proposed
**Date**: 2026-10-19

## Summary

Settings becomes one place with its own grouped navigation, as Attio and Linear do it, and the Light / Dark / System switch leaves the sidebar footer for a row in Settings › Account › Preferences. The owner asked for both on 19 October 2026 ("get rid of this from the bottom. build a proper settings").

## Requirements

- AC-681: Opening Settings swaps the app sidebar for the settings navigation: a "Settings" heading with a back control that returns to the page you came from (the workspace home when there is none), then groups with small capital labels.
- AC-682: The groups, in order:
  - **Account**: Preferences, Calendars.
  - **Workspace**: Objects, Background jobs.
  - **Scheduling**: Booking pages, Forms (links into Captures until each has workspace wide settings of its own).

  A group with no page the member may open is left out, never shown locked.
- AC-683: Every settings page has the same header: a trail ("Account › Preferences"), the title, a one line description, then a divider. The body is grouped cards under section headings; each row is a title, a muted description and its control on the right.
- AC-684: Account › Preferences has "Interface theme" as a row with a Select (System preference, Light, Dark). The choice applies the moment it changes, with no Save, and is kept as today's theme choice is kept (this browser, spec 0003 theme).
- AC-685: The sidebar footer no longer holds the theme switch. The sidebar keeps a Settings entry at its foot (a gear icon and "Settings"), which is how you reach Settings, with ⌘, as its shortcut.
- AC-686: Settings opens on Account › Preferences. The old addresses (`/settings/objects`, `/settings/jobs`, `/settings/calendar`) keep working; Calendar moves under Account and its old address redirects to the new one.
- AC-687: The settings navigation works by keyboard (arrow keys inside the list, Tab past it), marks the current page with `aria-current="page"`, and keeps its place when a page loads.

## Decision

Reuse the library's SettingsLayout and the Sidebar module. The settings navigation is a variant of the Sidebar (the same rows, groups and keyboard use) rather than a second navigation component. Settings rows use the existing SettingsStack and Field components; a "setting row" (title, description, control) is added as a SettingsStack variant if no current molecule fits, with its README saying why.

Only the theme is a preference in this spec, because it is the only one with a source today. Time format, start of week and language each need a stored per member preference, which is a separate decision (Follow-up).

## Build plan

1. The Sidebar variant for settings, its stories, and the grouped `settingsNav` with the Account, Workspace and Scheduling groups.
2. Account › Preferences with the Interface theme row; remove ThemeSwitch from WorkspaceFrame's footer and put the Settings entry there.
3. Move Calendar to Account › Calendars with a redirect from the old address; point Settings' index at Preferences.
4. Unit tests for the nav (groups, hidden groups, current page) and a web test that the footer no longer renders the switch.

## Consequences

The sidebar footer gets lighter, and every later settings page (Members, Profile, Notifications) has a group to land in. The theme takes two clicks to reach instead of one, which is the trade the owner asked for.

## Follow-up

- Per member preferences (time format, start of week, language, time zone): needs a stored preference and its own spec.
- Account › Profile and Workspace › Members arrive with their features (#8 and later).

## Rationale

The pattern comes from the Cal.com study in `0025-booking-pages/0025-calcom-alignment.md` (Settings section), which drew on Attio for the grouped navigation and Linear for the row density and the instant theme row.
