# Hospitality

The Hospitality suite's screens (spec 0065). H0 holds the setup the apps share; each app's own screens arrive with
its slice (Menu H1, Menu QR H2, Table seating H3 and H4).

| Screen | Brief |
|---|---|
| `AppsScreen.tsx` | Settings › Apps (AC-6501 to AC-6506): one card per app, Install (the business card the first time, Menu with Menu QR in one step) or Installed with Remove, which asks first. Nothing about the apps shows until Timefix opens early access. |
| `BusinessCardDialog.tsx` | The first install's one short card: name, kind, the first place's address, time zone and currency, prefilled from the workspace. |
| `BusinessScreen.tsx` | Settings › Business (AC-6507, AC-6508): the profile, saved with Save, then each place's card. |
| `PlaceCard.tsx` | One place: its week of opening hours (the library HoursEditor with `pastMidnightUntil`, saved as each changes, checked by the same `hoursProblem` the server runs), special days, and details. |
| `FloorScreen.tsx` | One place's tables and areas (AC-6509): Add tables ("T1 to T10, seats 2 to 4") with a live line saying what it adds, drag to reorder, an Online switch per row, Edit (label, seats, area, joins), Archive and Delete (asks first). |
| `ComingScreen.tsx` | Menus, QR codes, Reservations and Service until their apps arrive: shown only while the app is installed, else not found. |

Data comes only from `data.hospitality` (`packages/data/src/hospitality/store.ts`): every write shows at once where
it can and goes back with the server's reason when refused.
