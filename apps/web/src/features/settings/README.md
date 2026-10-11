# Settings

## `/w/$slug/settings/jobs` (JobsScreen)

- **Purpose**: Settings, Background jobs (spec 0008, AC-118): the workspace's long work, with its progress, live.
- **Main task**: see how a job is doing and cancel it, with a confirm. Owners and admins (`jobs.manage`) see every job, system ones included; members see their own.
- **Leaves out**: confirming a prepared job and retry controls (spec 0008 milestone 2), the daily cleanup's details (milestone 3), and the rest of Settings (#13 brings `SettingsLayout`; until then the page sits in the workspace frame, with a Settings section in the sidebar).

Built from library parts only: TopBar, Table, Badge (the status), ProgressBar ("done of total", indeterminate when the size isn't known), RelativeTime, Button, Modal (the cancel confirm, `tone="danger"`) and EmptyState (loading, empty, and error with Try again). "Run a test job" shows for `jobs.manage` locally and in previews (AC-123): 20,000 synthetic items, every 50th refused, so the bar and the refusal summary both show.

## The finish toast (toast.ts)

- **Purpose**: tell the person when a job they started in this browser ends while the app is open (AC-119).
- **Main task**: say how it ended ("Test job: Done", "Test job: Done, 6 refused", "Failed", "Cancelled"), with View, which opens the Background jobs page.
- **Leaves out**: jobs started elsewhere, and notifications that outlive the tab (#28).
