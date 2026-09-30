# CRM attributes research: Attio, Twenty, HubSpot, Salesforce, Pipedrive

Researched 2026-10-01. Sources: official docs and code only (see section 6). Anything I could not confirm in an official source is marked **UNVERIFIED**.

**Legend:** ✓ = supported natively · partial = possible through a workaround or a limited variant · ✗ = not supported, or not found in the docs · `code` = exact type or API name.

**Method notes**
- **Attio:** the raw `.md` pages on docs.attio.com (REST API reference plus the OpenAPI spec for "Create an attribute") and the attio.com/help centre.
- **Twenty:** the `twentyhq/twenty` `main` branch, where the latest release is `twenty/v2.43.0` (2026-09-28). Types come from `packages/twenty-shared/src/types/*`. Standard fields come from `packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/compute-*-standard-flat-field-metadata.util.ts`. I also used docs.twenty.com.
- **Salesforce:** help.salesforce.com pages render with JavaScript, and developer.salesforce.com returned 403 to this environment. I used the official PDFs on resources.docs.salesforce.com instead: the *Metadata API Developer Guide* and the *Object Reference*, both v68.0, Winter '27.
- **HubSpot and Pipedrive:** knowledge base, support centre and developer docs. Some page content arrived through a summarising fetcher, so exact internal property names for HubSpot are left out unless the docs confirmed them.

---

## 1. Attribute (field) type catalogue

**Exact type names:**
- **Attio** (API `type` enum, 17 types): `text`, `number`, `checkbox`, `currency`, `date`, `timestamp`, `rating`, `status`, `select`, `record-reference`, `actor-reference`, `location`, `domain`, `email-address`, `phone-number`, `interaction`, `personal-name`. The "Create an attribute" enum leaves out `interaction` and `personal-name`. The type docs also say you cannot create your own `domain` or `email-address` attributes. The UI adds **Formula**, **Relationship**, "User" (which is `actor-reference`) and "Multi-select" (which is `select` with `is_multiselect`).
- **Twenty** (`FieldMetadataType` enum, 25 values): `ACTOR`, `ADDRESS`, `ARRAY`, `BOOLEAN`, `CURRENCY`, `DATE`, `DATE_TIME`, `EMAILS`, `FILES`, `FULL_NAME`, `LINKS`, `MORPH_RELATION`, `MULTI_SELECT`, `NUMBER`, `NUMERIC`, `PHONES`, `POSITION`, `RATING`, `RAW_JSON`, `RELATION`, `RICH_TEXT`, `SELECT`, `TEXT`, `TS_VECTOR`, `UUID`.
- **HubSpot** (API `type` → `fieldType`):
  - `bool` → `booleancheckbox`, `calculation_equation`
  - `enumeration` → `booleancheckbox`, `checkbox`, `radio`, `select`, `calculation_equation`
  - `date` → `date`
  - `datetime` → `date`
  - `string` → `file`, `text`, `textarea`, `calculation_equation`, `html`, `phonenumber`
  - `number` → `number`, `calculation_equation`
- **Salesforce** (Metadata API `FieldType`): `Address`, `AutoNumber`, `Lookup`, `MasterDetail`, `MetadataRelationship`, `Checkbox`, `Currency`, `Date`, `DateTime`, `Email`, `EncryptedText`, `ExternalLookup`, `IndirectLookup`, `Number`, `Percent`, `Phone`, `Picklist`, `MultiselectPicklist`, `Summary`, `Text`, `TextArea`, `LongTextArea`, `Url`, `Hierarchy`, `File`, `Html`, `Location`, `Time`, `Array`, `Integer`, `Long`. A Formula is a field with the `formula` property set, not a separate type.
- **Pipedrive** (`field_type`): `varchar`, `varchar_auto`, `text`, `double`, `monetary`, `date`, `set`, `enum`, `user`, `org`, `people`, `phone`, `time`, `timerange`, `daterange`, `address`. These map to the 16 UI custom field types.

| # | Type | What it stores | Config options seen | Attio | Twenty | HubSpot | Salesforce | Pipedrive |
|---|---|---|---|---|---|---|---|---|
| 1 | Text | Short string | default, unique, min/max length, regex (HS), max length (SF `length`) | ✓ `text` (≤10 MB, always single-value) | ✓ `TEXT` (`settings.displayedMaxRows`) | ✓ Single-line text (`string`/`text`, 65,536 chars) | ✓ `Text` (`length`) | ✓ Text `varchar` (255) |
| 2 | Long text | Multi-line plain text | visible rows | partial: `text` supports shift+enter line breaks | partial: the UI "Long Text" is `TEXT` + `displayedMaxRows` (no separate enum value) | ✓ Multi-line text (`textarea`) | ✓ `TextArea`, `LongTextArea` (`visibleLines`) | ✓ Large text `text` (~65k) |
| 3 | Rich text | Formatted text or blocks | — | ✗ | ✓ `RICH_TEXT` `{blocknote, markdown}` | ✓ Rich text (`html`, ≤64 KB incl. images) | ✓ `Html` ("Text Area (Rich)") | ✗ |
| 4 | Autocomplete text | Text that suggests earlier values | — | ✗ | ✗ | ✗ | ✗ | ✓ Autocomplete `varchar_auto` |
| 5 | Number | Integer or decimal | decimals, grouping, min/max, int vs float | ✓ `number` (float, 4 dp; UI decimals 0 or 2, grouping) | ✓ `NUMBER` (`settings.dataType` float/int/bigint, `decimals`, `type` number\|percentage) + `NUMERIC` (stored as a string, arbitrary precision) | ✓ Number: Formatted (≤20 digits) or Unformatted; min/max and max-decimals rules | ✓ `Number` (`precision`, `scale`); the enum also has `Integer` and `Long` | ✓ Numerical `double` |
| 6 | Percent | Ratio shown as % | decimals | partial: `number` (help says it is used "such as percentages"; no % type) | partial: `NUMBER` with `settings.type='percentage'` | partial: Number with format "Percentage" (stored as decimal .75) | ✓ `Percent` | ✗ |
| 7 | Currency | Amount plus currency code | default currency, per-record code, display, decimals | ✓ `currency`: `default_currency_code` (ISO 4217) is set **per attribute** and cannot be overridden per record; `display_type` code/name/narrowSymbol/symbol; 4 dp | ✓ `CURRENCY` `{amountMicros, currencyCode}` **per record**; `settings.format` short\|full, `decimals` | ✓ Number with Currency format (account currency); deals have a per-record Currency | ✓ `Currency` (precision/scale); per-record `CurrencyIsoCode` (Opportunity) | ✓ Monetary `monetary` (value + currency) |
| 8 | Duration | Length of time | — | ✗ | ✗ | partial: Rollup format "Duration" | ✗ | ✗ (use time range) |
| 9 | Date | Calendar date, no timezone | dynamic default, display format, date rules | ✓ `date` (ISO 8601; static default or dynamic ISO-duration default such as `P1M`) | ✓ `DATE` (`displayFormat` RELATIVE/USER_SETTINGS/CUSTOM; default fn `now`) | ✓ Date picker (`date`; rules: future only, past only, range, Mon–Fri) | ✓ `Date` | ✓ Date `date` |
| 10 | Datetime / timestamp | Instant in UTC | same as date | ✓ `timestamp` (UTC, nanosecond precision) | ✓ `DATE_TIME` | ✓ Date and time picker (`datetime`) | ✓ `DateTime` | partial: system times only (`add_time`, `won_time`…) |
| 11 | Time of day | HH:MM:SS | — | ✗ | ✗ | ✗ | ✓ `Time` | ✓ Time `time` |
| 12 | Date range / time range | Start and end | — | ✗ | ✗ | ✗ | ✗ | ✓ `daterange`, `timerange` |
| 13 | Checkbox / boolean | true/false | default | ✓ `checkbox` (no null) | ✓ `BOOLEAN` | ✓ Single checkbox (`bool`/`booleancheckbox`) | ✓ `Checkbox` | ✗ |
| 14 | Select | One option from a list | label, value, **colour**, order, archive, default option | ✓ `select` with `is_multiselect=false`: ≤5,000 colour-coded, reorderable options; cannot be unique; writing an unknown option is an error | ✓ `SELECT`: options `{label, value, position, color}`; 25 tag colours (red…gray) | ✓ Dropdown select / Radio select (`enumeration`; ≤5,000 options; conditional options) | ✓ `Picklist`: `valueSet`, `restricted`, hex `color`, global value sets | ✓ Single option `enum` |
| 15 | Multi-select | Many options | same as select | ✓ `select` with `is_multiselect=true` (shown as "Multi-select" in the UI) | ✓ `MULTI_SELECT` | ✓ Multiple checkboxes (`checkbox`) | ✓ `MultiselectPicklist` | ✓ Multiple options `set` |
| 16 | Status (stage) | Pipeline stage; kanban columns | ordered statuses, target time, celebration, won/lost | ✓ `status`: single-select; each status has `target_time_in_status` and `celebration_enabled`; filter on `active_from` (time in stage); kanban needs it | partial: `SELECT` (Opportunity.stage, Task.status drive kanban) | partial: Deal stage + Pipeline (dropdowns, probability per stage) | partial: `StageName` picklist + `Probability`, `ForecastCategory`, `IsClosed`, `IsWon` | partial: system `pipeline_id` + `stage_id` + `status` (open/won/lost) |
| 17 | Rating | Stars | — | ✓ `rating` (0–5; UI 1–5 stars) | ✓ `RATING` (star rating 1–5; options list) | ✗ | ✗ | ✗ |
| 18 | Score | Computed score | — | ✗ (use formula) | ✗ | partial: "HubSpot score" (contact) and "Deal score" (AI) properties; a creatable score type is UNVERIFIED | ✗ (system `IqScore` on Opportunity) | ✗ |
| 19 | Email (single) | One email | domain allow/block list | partial: `email-address` single (User object) | partial: `EMAILS` with `maxNumberOfValues: 1` | ✓ Email (domain allowlist/blocklist) | ✓ `Email` | ✗ as a custom type |
| 20 | Emails (multi) | List with a primary | max values, click action | ✓ `email-address` multiselect: normalised, with `email_domain`, `email_root_domain`, `email_local_specifier`; strict validation; not user-creatable | ✓ `EMAILS` `{primaryEmail, additionalEmails}`; `settings.maxNumberOfValues`, `clickAction` | ✗ (single `email`; "additional emails" UNVERIFIED) | ✗ (separate fields) | partial: Person `emails` `[{value, primary, label}]` |
| 21 | Phone(s) | Phone numbers | E.164, default country, labels | ✓ `phone-number`: E.164, `original_phone_number`, `country_code`, `normalized_phone_number`; user-creatable on any object; People field is multiselect | ✓ `PHONES` `{primaryPhoneNumber, primaryPhoneCountryCode, primaryPhoneCallingCode, additionalPhones}` | ✓ Phone number (`phonenumber`; formats by country code) | ✓ `Phone` (client does the formatting) | ✓ Phone `phone`; Person `phones` `[{value, primary, label}]` |
| 22 | URL | URL | auto https, domain allow/block | partial: use `text` (the `domain` type strips paths) | ✓ `LINKS` (`settings.type='url'`) | ✓ URL (adds https://, domain allow/blocklist) | ✓ `Url` | partial: URLs in Text fields are clickable |
| 23 | Domain | Normalised domain + root | unique | ✓ `domain` `{domain, root_domain}`: paths stripped; not user-creatable; Company `domains` is unique and multi | ✓ `LINKS` with `settings.type='domain'` (Company `domainName`, unique) | partial: "Company domain name" (text) | ✗ (`Website` is a url) | ✗ (org `website` string) |
| 24 | Links (multi, labelled) | URLs with labels | max values | ✗ | ✓ `LINKS` `{primaryLinkUrl, primaryLinkLabel, secondaryLinks[]}` | ✗ | ✗ | ✗ |
| 25 | Location / address | Structured address | enabled subfields, geocode | ✓ `location`: `line_1..4`, `locality`, `region`, `postcode`, `country_code` (ISO 3166-1 α2), `latitude`, `longitude`; writes are atomic; strings get parsed | ✓ `ADDRESS`: `addressStreet1/2`, `addressCity`, `addressState`, `addressPostcode`, `addressCountry`, `addressLat`, `addressLng`; `settings.subFields` | partial: separate text properties (street, city, state, postal code, country) | ✓ `Address` compound (Billing/Shipping/Mailing/Other) | ✓ Address (Google Maps autocomplete; subfields `country`, `admin_area_level_1/2`, `locality`, `sublocality`, `route`, `street_number`, `subpremise`, `postal_code`) |
| 26 | Geolocation | lat/lng | — | partial: inside `location`, not filterable | partial: `addressLat/Lng` | ✗ | ✓ `Location` | ✗ (UNVERIFIED) |
| 27 | Full name | First/last name | — | ✓ `personal-name` `{first_name, last_name, full_name}`: People only, not creatable | ✓ `FULL_NAME` `{firstName, lastName}` | partial: separate First name / Last name | partial: compound Name (`FirstName`, `LastName`, `MiddleName`, `Salutation`, `Suffix`) | partial: `name` string |
| 28 | Member / user reference | Workspace user(s) | single or multi, default current user | ✓ `actor-reference` (UI "User"; single or multi; dynamic default `current-user`) | partial: `RELATION` to `workspaceMember` (Company.accountOwner, Opportunity.owner) | ✓ HubSpot user (multi-select allowed; custom owner properties) | ✓ `Lookup` to User (`OwnerId`) | ✓ User `user` |
| 29 | Actor / audit | Who or what created or edited | source enum | ✓ `actor-reference` types `workspace-member`, `api-token`, `system`; `created_by` on every object | ✓ `ACTOR` `{source, workspaceMemberId, name, context}`; source ∈ EMAIL, CALENDAR, WORKFLOW, AGENT, API, IMPORT, MANUAL, SYSTEM, WEBHOOK, APPLICATION; `createdBy` + `updatedBy` on every object | UNVERIFIED | ✓ `CreatedById`, `LastModifiedById` (audit fields) | UNVERIFIED |
| 30 | Record reference (one-way) | Pointer to record(s) | allowed objects, multi | ✓ `record-reference` with `relationship: null`: `allowed_objects`, `is_multiselect`; write fails if the target doesn't exist; drill-down path filters | ✗ (relations are always two-sided) | ✗ (associations are two-sided) | ✓ `Lookup` (also `ExternalLookup`, `IndirectLookup`) | ✓ `org` / `people` custom fields (one value each) |
| 31 | Relationship (two-way) | Paired references kept in sync | cardinality, reverse name, onDelete | ✓ relationship attribute (a pair of `record-reference`s): 1:1, 1:n, n:1, n:n; Pro/Enterprise | ✓ `RELATION`: `settings.relationType` MANY_TO_ONE\|ONE_TO_MANY; `onDelete` CASCADE/RESTRICT/SET_NULL/NO_ACTION; n:n through a junction object | ✓ Associations (labels, limits, primary) | ✓ `Lookup` / `MasterDetail` (related lists) | partial: a deal links to 1 person + 1 org |
| 32 | Polymorphic reference | One field pointing at several object types | allowed-object list | partial / UNVERIFIED: `allowed_objects` is an array (minItems 1), but the docs say references are "usually constrained to referencing a specific object"; relationships join exactly 2 objects | ✓ `MORPH_RELATION` (e.g. taskTarget `targetPerson`/`targetCompany`/`targetOpportunity` share one `morphId`) | partial: any two object types can be associated, but not through one field | ✓ polymorphic reference fields (the Object Reference labels some fields "polymorphic relationship field") | ✗ |
| 33 | Interaction | First/last/next email or meeting | — | ✓ `interaction` `{interaction_type: email\|calendar-event, interacted_at, owner_actor}`: system-created, read-only | ✗ (email and calendar are linked through `messageThreadTargets` / `calendarEventTargets` relations) | partial: Last activity date, Last contacted (date properties) | partial: `LastActivityDate`; Contact `FirstCallDateTime`, `FirstEmailDateTime` | partial: `last_incoming_mail_time`, `last_outgoing_mail_time`, `email_messages_count` |
| 34 | Formula | Value computed from the same record | output type, decimals | ✓ Formula attribute (Pro/Enterprise): `if()`, `dateAdd()`, `timeSpentIn()`; output type detected; nests ≤3 formulas deep; no custom code | ✗ ("Formula fields are coming in H2 2026") | ✓ Calculation (`calculation_equation` + `calculationFormula`; number/bool/string/enumeration; Pro/Enterprise) | ✓ Formula (`formula`, `formulaTreatBlanksAs`) | partial: formula on Numerical/Monetary **deal** fields (Premium+, ≤10 per company; seen in a search snippet) |
| 35 | Rollup | Aggregate over related records | function, filter | UNVERIFIED (formula docs don't mention rollups) | ✗ | ✓ Rollup (Min, Max, Count, Sum, Average; Pro/Enterprise) | ✓ Roll-Up Summary `Summary` (`summaryOperation` Count/Min/Max/Sum; master-detail only) | ✗ |
| 36 | Lookup / synced field | Copy of a field on a related record | — | partial: no lookup type; drill-down filters via `paths` | ✗ | ✓ Property sync (Pro/Enterprise) | ✓ cross-object formula | ✗ |
| 37 | AI-generated | Value filled by an LLM | prompt, source, trigger | ✓ AI autofill on text/number/currency/select/multi-select: Summarize record, Web agent, Prompt completion, Classify record; run by hand or in bulk; credits (10 per record for web agent, 1 for the others) | ✗ (UNVERIFIED) | ✓ Smart properties (Data agent prompt; sources: web research, company website, property data, call transcripts). Seen in a knowledge-base search snippet only | UNVERIFIED | UNVERIFIED |
| 38 | Auto number | Sequential human-readable ID | display format | ✗ | ✗ | ✗ (UNVERIFIED) | ✓ `AutoNumber` (`displayFormat`) | ✗ |
| 39 | Record ID | System primary key | — | ✓ Record ID (`record_id`, not editable) | ✓ `UUID` (`id`, default fn `uuid`) | ✓ Record ID | ✓ `Id` | ✓ integer ids |
| 40 | File | Attachments held in a field | max files, size | ✗ (not an attribute type) | ✓ `FILES` (`settings.maxNumberOfValues`) | ✓ File (≤10 files per property) | ✓ `File` (in the enum) | ✗ (not among the 16 types) |
| 41 | JSON | Any object | — | ✗ | ✓ `RAW_JSON` | ✗ (not in the documented type table) | ✗ | ✗ |
| 42 | Array | List of strings | max values | ✗ | ✓ `ARRAY` | ✗ | partial: `Array` is in the FieldType enum; context UNVERIFIED | ✗ |
| 43 | Encrypted / sensitive | Protected text | — | ✗ | ✗ | partial: property "sensitivity settings" (Enterprise) | ✓ `EncryptedText` (Classic Encryption) | ✗ |
| 44 | Position | Rank for manual sorting | — | ✗ | ✓ `POSITION` (system) | ✗ | ✗ | ✗ |
| 45 | Search vector | Full-text index | — | n/a | ✓ `TS_VECTOR` (system `searchVector`) | n/a | n/a | n/a |
| 46 | Hierarchy | User → user chain | — | ✗ (use a self-relationship) | ✗ (use a self-relation) | ✗ | ✓ `Hierarchy` (User object only) | ✗ |
| 47 | Labels | Coloured tags on a record | — | (use multi-select) | (use `MULTI_SELECT`) | ✗ | ✗ | ✓ system `label_ids` on deal/person/org |
| 48 | Created/updated timestamps | System audit times | — | ✓ `created_at` (every object) | ✓ `createdAt`, `updatedAt`, `deletedAt` (soft delete) | ✓ Create date, Last modified date | ✓ `CreatedDate`, `LastModifiedDate`, `IsDeleted` | ✓ `add_time`, `update_time` |

**Composite types.** Several types store more than one value. It's worth copying these shapes:
- Twenty `CURRENCY`: `{amountMicros, currencyCode}`
- Twenty `EMAILS`: `{primaryEmail, additionalEmails}`
- Twenty `PHONES`: `{primaryPhoneNumber, primaryPhoneCountryCode, primaryPhoneCallingCode, additionalPhones}`
- Twenty `LINKS`: `{primaryLinkUrl, primaryLinkLabel, secondaryLinks}`
- Twenty `FULL_NAME`: `{firstName, lastName}`
- Twenty `RICH_TEXT`: `{blocknote, markdown}`
- Twenty `ACTOR`: `{source, workspaceMemberId, name, context}`
- Attio `location`: 11 properties
- Attio `email-address`: 5 properties
- Attio `domain`: `domain` + `root_domain`

---

## 2. Attribute-level features

| Feature | Attio | Twenty | HubSpot | Salesforce | Pipedrive |
|---|---|---|---|---|---|
| **Required** | `is_required`: applies to new records or entries only, no backfill needed. UI: custom objects only. Deals ship with required name, stage and owner. | ✗ for custom fields ("you cannot make custom fields required", use workflows). DB-level `isNullable` exists on system fields. | UNVERIFIED (per-object create form and pipeline-stage requirements exist, but I did not confirm them) | ✓ `required` | ✓ Required fields (Professional+). Deal fields can be required per pipeline or stage. Import, bulk edit, API and automations bypass the rule. "Important fields" give a soft warning (Growth). |
| **Unique** | `is_unique`: enforced for new data only, not retroactively. UI: custom objects, Deals, Users, Workspaces; not Companies, People or lists. `select` cannot be unique. | `isUnique` (e.g. `emails`, `domainName`) | `hasUniqueValue`: ≤10 per object; cannot be changed once set | ✓ `unique`, `caseSensitive`, `externalId` | UNVERIFIED |
| **Default value** | Static defaults on every type. Dynamic defaults: `current-user` for actor-reference, ISO-8601 duration (`P1M`) for date/timestamp. The API says defaults are "not currently supported on people or company objects". | `defaultValue` on every type except `RELATION`, `MORPH_RELATION`, `FILES`, `TS_VECTOR`. Functions `uuid` and `now`. Select has a default option. | Default values for text, number and enumeration | ✓ `defaultValue` | UNVERIFIED |
| **Description / help text** | `description` | `description` + `icon` | Description / "Documentation" tab | `description` + `inlineHelpText` (field-level help) | Field descriptions shown as info icons (Growth) |
| **Archive vs delete** | Attributes can only be archived. Archived attributes restore at any time with values intact, but restoring does not re-add them to views. System and enriched attributes cannot be archived. Deleting a select option deletes its data. The API draws the same line: archive sets `is_archived`, DELETE is permanent. | Deactivate (`isActive=false`): hidden in the UI, data kept, still in the API. Standard fields cannot be deleted, only deactivated. | Archive, then permanent deletion after 90 days, with restore possible inside that window. Can also delete immediately. | UNVERIFIED | Delete removes the field and all its data. A usage count is shown first. No archive step. |
| **Historic values / history** | ✓ Built into the data model: every value has `active_from`, `active_until` and `created_by_actor`, and history can be queried through the API. The UI's "View edit history" is Pro/Enterprise. Status and select can be filtered by `active_from`, e.g. "stage changed this week". | Field flag `isAuditLogged` plus a `timelineActivities` relation on every standard object. How deep the history goes is UNVERIFIED. | Property history (per record, exportable) | `trackHistory` (Field History Tracking), `trackTrending`, `trackFeedHistory` | UNVERIFIED |
| **Validation rules** | Type-level only (email shape, E.164, ISO dates). No custom rules found. | Type-level only (UNVERIFIED beyond that) | ✓ Text: spaces, min/max chars, character classes, casing, regex (Pro/Enterprise). Number: min/max, max decimals. Date: future/past/range/weekdays. Email and URL: domain rules. | ✓ Validation Rules (`errorConditionFormula`, `errorDisplayField`), lookup filters | ✗ (UNVERIFIED) |
| **Field-level permissions** | ✗. Not found; access is set per object or list. Only admins or Full-access members manage attributes. | ✓ Per role, per field: See / Edit / No access. Row-level permissions are on the Organization plan. | ✓ View and edit / View only / No access per user or team (Enterprise) | ✓ Field-Level Security (`PermissionSetFieldPermissions.readable/editable`) | ✓ Controls who can view and edit a field (Premium) |
| **Read-only / system** | `is_system_attribute`. Enriched values cannot be overridden through the API. Interaction values cannot be written. | `isSystem`, `isUIEditable`, `isUIReadOnly` (being phased out), `isSystemSideEffect` | Auto-set properties (Create date, number of associated contacts…) | System and audit fields are read-only; formula and roll-up fields too | "System fields" (created date, email count…) |
| **Groups / sections** | Record pages let you choose which attributes to show. Named groups are UNVERIFIED. | ✓ View field groups (`compute-standard-*-view-field-groups`) | ✓ Property groups | UNVERIFIED (page layout sections) | ✓ Field groups; deal and lead defaults sit in a "summary" group |
| **Conditional / dependent** | ✗ (not found) | ✗ (not found) | ✓ Conditional options: a controlling enumeration filters a dependent enumeration's options (Pro/Enterprise) | ✓ Dependent picklists (`controllingField`, `valueSettings`) | ✓ Pipeline-specific fields and stage-specific required fields (Premium) |
| **Calculated fields** | Formula (Pro+), AI autofill | ✗ (formula "H2 2026") | Calculation, Rollup, Property sync, Smart properties | Formula, Roll-Up Summary, AutoNumber | Formula fields (deals, numeric/monetary) |
| **Multi-value** | `is_multiselect` flag on select, record-ref, actor-ref, email, phone, domain | Separate types (`SELECT` vs `MULTI_SELECT`); `EMAILS`/`PHONES`/`LINKS`/`ARRAY`/`FILES` take `maxNumberOfValues` | Decided by the type | Decided by the type | Decided by the type |
| **AI fill** | ✓ AI autofill (see row 37) | ✗ | ✓ Smart properties (search snippet only) | UNVERIFIED | UNVERIFIED |
| **Limits** | ≤5,000 select options | ≤1,600 fields per object (Postgres limit, deleted fields included) | ≤5,000 options (or 512,000 bytes) per enumeration; ≤10 unique properties | UNVERIFIED | ≤10 formula fields (search snippet) |

---

## 3. Standard objects and their prebuilt attributes

### 3.1 Attio

In Attio, People and Companies are always on. Deals, Users and Workspaces are off by default and must be enabled by an admin. Every object has these system attributes: **Record ID**, **Created at** (`created_at`, timestamp), **Created by** (`created_by`, actor-ref), **List entries** (filter only) and **Next due task**. All are read-only.

**People** (`people`). People records are enriched, and enriched values cannot be overridden through the API.

| Attribute | Slug | Type | Notes |
|---|---|---|---|
| Record ID | `record_id` | system | not editable |
| Name | `name` | personal-name | enriched |
| Email addresses | `email_addresses` | email-address | unique, multi; needed for enrichment |
| Company | `company` | record-reference | relationship ↔ Company `team`; enriched |
| Description | `description` | text | enriched |
| Job title | `job_title` | text | enriched |
| Phone numbers | `phone_numbers` | phone-number | multi |
| Primary location | `primary_location` | location | enriched |
| AngelList, Facebook, Instagram, LinkedIn, Twitter | `angellist`, `facebook`, `instagram`, `linkedin`, `twitter` | text | enriched |
| Twitter follower count | `twitter_follower_count` | number | enriched, system |
| Profile picture | slug UNVERIFIED | — | enriched |
| First/Last interaction; First/Last email interaction; First/Last/Next calendar interaction | `first_email_interaction`, `last_email_interaction`, `first_calendar_interaction`, `last_calendar_interaction`, `next_calendar_interaction` (slugs for the combined first/last are UNVERIFIED) | interaction | read-only |
| Connection strength | `strongest_connection_strength` | select | read-only |
| Strongest connection | `strongest_connection_user` | actor-reference | read-only |
| Associated deals | `associated_deals` | record-reference | ↔ Deal `associated_people` (if Deals on) |
| Associated users | `associated_users` | record-reference | ↔ User `person` (if Users on) |
| List entries, Next due task, Created at, Created by | — | system | read-only |

**Companies** (`companies`). Custom unique attributes cannot be created on Companies.

| Attribute | Slug | Type | Notes |
|---|---|---|---|
| Record ID | `record_id` | system | |
| Domains | `domains` | domain | unique, multi; needed for enrichment |
| Name | `name` | text | enriched |
| Description | `description` | text | enriched |
| Team | `team` | record-reference | multi; ↔ Person `company` |
| Categories | `categories` | select | multi; enriched |
| Primary location | `primary_location` | location | enriched |
| AngelList, Facebook, Instagram, LinkedIn, Twitter | same as People | text | enriched |
| Twitter follower count | `twitter_follower_count` | number | enriched |
| Logo | `logo_url` (named in the Workspaces doc) | text | enriched |
| Estimated ARR | `estimated_arr_usd` | select | range; not on the Free plan |
| Employee range | `employee_range` | select | not on the Free plan |
| Funding raised | `funding_raised_usd` | currency | not on the Free plan |
| Foundation date | `foundation_date` | date | |
| Interactions (same set as People) | | interaction | read-only |
| Connection strength, Strongest connection | | select / actor-ref | read-only |
| Associated deals | `associated_deals` | record-reference | ↔ Deal `associated_company` |
| Associated workspaces | `associated_workspaces` | record-reference | ↔ Workspace `company` |
| List entries, Next due task, Created at, Created by | | system | |

**Deals** (`deals`). Deals have no unique attribute by default.

| Attribute | Slug | Type | Notes |
|---|---|---|---|
| Deal name | `name` | text | required |
| Deal stage | `stage` | status | required; defaults Lead, In Progress, Won 🎉, Lost |
| Deal owner | `owner` | actor-reference | required |
| Deal value | `value` | currency | defaults to USD |
| Associated people | `associated_people` | record-reference | multi; ↔ Person `associated_deals` |
| Associated company | `associated_company` | record-reference | single; ↔ Company `associated_deals` |
| Record ID, List entries, Next due task, Created at, Created by | | system | |

**Users** (`users`):
- `person`: record-ref ↔ Person
- `primary_email_address`: required, unique. The object doc types it as `text`, but the email-address type doc says Users have an `email_address` email-address attribute. The two docs disagree.
- `user_id`: text, required, unique
- `workspace`: record-ref, multi
- plus the system attributes

**Workspaces** (`workspaces`):
- `workspace_id`: text, required, unique
- `name`: text
- `users`: record-ref, multi
- `company`: record-ref
- `avatar_url`: text
- plus the system attributes

### 3.2 Twenty (`main`, v2.43)

Every standard object gets these system fields:
- `id` (`UUID`, default `uuid`)
- `createdAt`, `updatedAt` (`DATE_TIME`, default `now`, display RELATIVE)
- `deletedAt` (`DATE_TIME`, soft delete)
- `position` (`POSITION`)
- `createdBy`, `updatedBy` (`ACTOR`)
- `searchVector` (`TS_VECTOR`)
- `timelineActivities` (1:n)
- `attachments` (1:n)
- `taskTargets`, `noteTargets` (1:n junctions)
- `calendarEventTargets`, `messageThreadTargets` (1:n)
- `agentChatThreadTargets` (1:n)

The tables below list only the fields each object adds on top of these.

**Person** (`person`)

| Field | Type | Notes |
|---|---|---|
| `name` | `FULL_NAME` | firstName, lastName |
| `emails` | `EMAILS` | **unique**, `maxNumberOfValues: 1` |
| `linkedinLink` | `LINKS` | |
| `jobTitle` | `TEXT` | |
| `phones` | `PHONES` | `maxNumberOfValues: 1` |
| `avatarUrl` | `TEXT` | system; deprecated in favour of `avatarFile` |
| `avatarFile` | `FILES` | system, max 1 |
| `company` | `RELATION` | MANY_TO_ONE → company, onDelete SET_NULL, join column `companyId` |
| `pointOfContactForOpportunities` | `RELATION` | ONE_TO_MANY → opportunity |
| `messageParticipants`, `calendarEventParticipants` | `RELATION` | 1:n |
| `listMemberships` | `RELATION` | 1:n → messageListMember |
| (deprecated) `phone` | text | kept in the entity class |

**Company** (`company`)

| Field | Type | Notes |
|---|---|---|
| `name` | `TEXT` | |
| `domainName` | `LINKS` | **unique**, `settings.type='domain'`, max 1; used to fetch the company icon |
| `address` | `ADDRESS` | |
| `linkedinLink` | `LINKS` | |
| `annualRevenue` | `CURRENCY` | |
| `people` | `RELATION` | 1:n → person |
| `accountOwner` | `RELATION` | n:1 → workspaceMember, SET_NULL |
| `opportunities` | `RELATION` | 1:n → opportunity |
| (deprecated) `addressOld` | text | |

Older Twenty releases shipped Company fields such as employees, ICP and xLink. They are **not** in `main` as of 2026-10-01; which version dropped them is UNVERIFIED.

**Opportunity** (`opportunity`)

| Field | Type | Notes |
|---|---|---|
| `name` | `TEXT` | |
| `amount` | `CURRENCY` | |
| `closeDate` | `DATE_TIME` | |
| `stage` | `SELECT` | not null, default `NEW`; options NEW (red), SCREENING (purple), MEETING (sky), PROPOSAL (turquoise), CUSTOMER (yellow) |
| `pointOfContact` | `RELATION` | n:1 → person, SET_NULL |
| `company` | `RELATION` | n:1 → company, SET_NULL |
| `owner` | `RELATION` | n:1 → workspaceMember |
| (deprecated) `probability` | | |

**Task:**
- `title`: `TEXT`
- `bodyV2`: `RICH_TEXT`
- `dueAt`: `DATE_TIME`
- `status`: `SELECT`, default `TODO`; options TODO (sky), IN_PROGRESS (purple), DONE (green)
- `assignee`: n:1 → workspaceMember, SET_NULL
- `taskTargets`: 1:n → `taskTarget`. Each taskTarget has `task` (n:1, CASCADE) and `targetPerson` / `targetCompany` / `targetOpportunity`, which are `MORPH_RELATION`s sharing one morphId, each CASCADE.

**Note:**
- `title`: `TEXT`
- `bodyV2`: `RICH_TEXT`
- `noteTargets`: same morph junction pattern as Task

**WorkspaceMember** (system settings object):
- `name`: `FULL_NAME`
- `userEmail`: `TEXT`, unique
- `userId`: `UUID`
- `avatarUrl`, `jobTitle`: `TEXT`
- `colorScheme`, `uiScale`, `openRecordIn`, `locale`, `timeZone`: `TEXT`
- `calendarStartDay`: `NUMBER`
- `dateFormat`, `timeFormat`, `numberFormat`: `SELECT`
- Relations: `assignedTasks`, `accountOwnerForCompanies`, `ownedOpportunities`, `messageParticipants`, `calendarEventParticipants`, `blocklist`, `agentMessages`, `agentChatThreads`, `timelineActivities`

### 3.3 HubSpot (top defaults; display names)

- **Contacts:**
  - Identity: Email, First name, Last name, Record ID
  - Phones: Phone number, Mobile phone number
  - Company and role: Company name, Job title, Associated company
  - Pipeline: Lifecycle stage (dropdown), Lead status (dropdown), Contact owner (user)
  - Address (text): Street address, City, State/Region, Postal code, Country/Region
  - Web: Website URL, Email domain
  - Dates: Create date, Last modified date, Last activity date, Last contacted
  - Sources: Original Traffic Source, Latest Traffic Source
  - Firmographics: Industry, Annual revenue, Number of employees
  - Other: HubSpot score, Marketing contact status
- **Companies:**
  - Basics: Company name, Company domain name, Description, Industry (≈150 options), Type (prospect/partner/reseller/vendor…)
  - Size: Number of employees, Annual revenue (currency), Year founded
  - Contact: Phone number, City, State/Region, Country/Region, Time zone, LinkedIn company page (URL)
  - Pipeline: Owner (user), Lifecycle stage, Close date
  - Hierarchy: Parent company (lookup)
  - Auto-set: Create date, Last activity date, Number of associated contacts, Number of associated deals, Total revenue
  - Other: Web Technologies, Record ID
- **Deals:**
  - Basics: Deal name, Amount (currency), Close date, Currency, Deal type (New/Existing Business), Priority, Deal description
  - Pipeline: Deal stage, Pipeline, Deal owner (user), Forecast category, Next step
  - Probability: Deal probability (percentage, set by stage), Weighted amount
  - Outcome: Closed won reason, Closed lost reason, Is Closed Won, Is closed lost, Days to close
  - Recurring revenue: Annual recurring revenue, Monthly recurring revenue
  - Auto-set: Create date, Last activity date, Number of associated contacts, Deal score (AI)

### 3.4 Salesforce (Object Reference v68.0; API names)

Every object has the system and audit fields `Id`, `IsDeleted`, `CreatedById`, `CreatedDate`, `LastModifiedById`, `LastModifiedDate`, `LastViewedDate` and `LastReferencedDate`.

- **Account:**
  - Identity: `Name`, `AccountNumber`, `Site`, `TickerSymbol`, `DunsNumber`
  - Classification: `Type` (picklist), `Industry` (picklist), `Rating` (picklist), `Ownership`, `Sic`, `NaicsCode`
  - Size: `AnnualRevenue` (currency), `NumberOfEmployees` (int), `YearStarted`
  - Contact: `Phone`, `Fax`, `Website` (url), `PhotoUrl`
  - Addresses: `BillingAddress` and `ShippingAddress` (address compounds with street/city/state/postal/country/lat/lng parts)
  - Ownership and hierarchy: `OwnerId` (ref User), `ParentId` (self-ref hierarchy)
  - Other: `Description` (textarea), `AccountSource` (picklist), `LastActivityDate`, `RecordTypeId`, `IsPersonAccount` (Person Account `Person*` fields)
- **Contact:**
  - Name: `Name` compound (`Salutation`, `FirstName`, `MiddleName`, `LastName`, `Suffix`)
  - Email and phones: `Email`, `Phone`, `MobilePhone`, `HomePhone`, `OtherPhone`, `Fax`
  - Role: `Title`, `Department`, `AccountId` (ref), `ReportsToId` (self-ref), `OwnerId`
  - Addresses: `MailingAddress`, `OtherAddress`
  - Personal: `Birthdate`, `Pronouns`, `GenderIdentity`
  - Consent: `HasOptedOutOfEmail`, `DoNotCall`, `IsEmailBounced`, `EmailBouncedDate`
  - Activity: `LastActivityDate`, `FirstCallDateTime`, `FirstEmailDateTime`
  - Other: `LeadSource`, `Description`, `PhotoUrl`
- **Opportunity:**
  - Basics: `Name`, `AccountId`, `ContactId`, `Type`, `LeadSource`, `CampaignId`, `Description`, `NextStep`, `OwnerId`
  - Value: `Amount` (currency), `ExpectedRevenue`, `CurrencyIsoCode` (multi-currency)
  - Timing: `CloseDate` (date), `FiscalQuarter`, `FiscalYear`
  - Stage: `StageName` (picklist), `Probability` (percent), `ForecastCategory`/`ForecastCategoryName`, `IsClosed`, `IsWon`
  - Stage tracking: `LastStageChangeDate`, `LastStageChangeInDays`, `AgeInDays`, `PushCount`
  - Products: `Pricebook2Id`, `HasOpportunityLineItem`
  - Activity: `LastActivityDate`, `HasOpenActivity`, `HasOverdueTask`
  - Other: `IsPrivate`, `IqScore`

### 3.5 Pipedrive (API names)

- **Person:**
  - Core: `name`, `owner_id`, `org_id`, `emails[]` and `phones[]` (each `{value, primary, label}`), `label_ids`, `visible_to`, `add_time`
  - Contact-sync fields: `postal_address`, `im[]`, `birthday`, `job_title`, `notes` (these appear once contact sync is set up)
  - `marketing_status`: no_consent / unsubscribed / subscribed / archived
  - System counts available through `include_fields`: `open_deals_count`, `closed_deals_count`, `won_deals_count`, `lost_deals_count`, `activities_count`, `done_activities_count`, `email_messages_count`, `last_incoming_mail_time`, `last_outgoing_mail_time`, `followers_count`, `files_count`, `notes_count`
- **Organization:** `name`, `owner_id`, `address` (structured), `website`, `linkedin`, `industry`, `annual_revenue`, `employee_count`, `label_ids`, `visible_to`, `add_time`
- **Deal:**
  - Core: `title`, `owner_id`, `person_id`, `org_id`, `value`, `currency`, `label_ids`, `visible_to`
  - Pipeline: `pipeline_id`, `stage_id`, `status` (open/won/lost), `probability`, `lost_reason`, `expected_close_date`
  - Timestamps: `close_time`, `won_time`, `lost_time`, `archive_time`
  - Flags: `is_deleted`, `is_archived`

---

## 4. Relationship features

| Capability | Attio | Twenty | HubSpot | Salesforce | Pipedrive |
|---|---|---|---|---|---|
| Cardinalities | 1:1, 1:n, n:1, n:n. Set by `is_multiselect` on each side of the pair. | `RelationType` has only `MANY_TO_ONE` and `ONE_TO_MANY` (no 1:1). n:n goes through a hidden junction object: "beta", enabled in Settings → Community → Features. The FAQ says native n:n is "coming H2 2026". | Associations between any records, with per-label limits ("many" or a custom number) | Lookup (1:1 or 1:n); Master-Detail (1:n); n:n through a **junction object** with two master-detail fields; `JunctionIdList` (Task/Event) | Deal → 1 person + 1 org. More links need extra single-value `org`/`people` custom fields. |
| Two-way | Relationship attributes come in pairs; editing one side updates the other. One-way record-references also exist. | Always two-way; you name the field on the target object | Associations are directional `typeId`s; paired labels ("Manager"/"Employee") | Lookup shows as a related list on the parent | n/a |
| Several object types | A relationship joins exactly 2 objects (they can be the same object). One-way refs take an `allowed_objects` array; whether one field can hold several types is UNVERIFIED. | ✓ `MORPH_RELATION` (task and note targets); not yet in CSV import/export | Any object pair, but each pair is its own association type | ✓ polymorphic reference fields | ✗ |
| Self-reference | ✓ (e.g. manager → person; recursive drill-down) | ✓ (docs warn against circular relations) | ✓ Parent company | ✓ `ParentId`, `ReportsToId`; `Hierarchy` for User | ✗ |
| Cascade on delete | UNVERIFIED | `onDelete`: CASCADE / RESTRICT / SET_NULL / NO_ACTION. Standard n:1 relations use SET_NULL; junction targets use CASCADE. Deleting a relation field removes links, not records. | UNVERIFIED | Lookup `deleteConstraint`: SetNull (default) / Restrict / Cascade. Master-Detail: deleting the master deletes its details; details inherit sharing; the relation is required; reparenting is optional. | UNVERIFIED |
| Labels / roles on a link | ✗ on the relation itself (use a list entry instead) | ✗ (use a junction object) | ✓ Association labels, single or paired (Pro/Enterprise); several labels per pair; "Primary company" is HubSpot-defined | ✓ Junction objects with fields: `OpportunityContactRole`, `AccountContactRelation` (a contact linked to many accounts) | ✗ |
| Lists with their own attributes | ✓ **Lists**: each list has one `parent_object`. Adding a record creates an **entry**, and entry attributes live on the entry, not the record. A record can be in the same list more than once (e.g. two job applications). A Status attribute drives the kanban. Lists have their own access settings (`workspace_access`, `workspace_member_access`) and are managed by list admins. | ✗ (use views or custom objects) | ✗ (segments are filters only) | ✗ (use a junction object) | ✗ |
| Writing references | Company by domain, person by email, user by `user_id`, workspace by `workspace_id`. The write fails if the target doesn't exist. | By id | By id + association type | By Id or external Id | By id |
| Cross-relation filters | ✓ `paths` drill-down across any depth; "only one multi-value relationship" per attribute path | UNVERIFIED | UNVERIFIED | SOQL relationship queries | UNVERIFIED |

---

## 5. Recommended attribute set for our CRM

### 5a. Attribute types: launch vs later

Design choices to make at launch (hard to add later):
- **Store every value as a version.** Copy Attio's `active_from`, `active_until` and `created_by_actor` on every value. This gives field history, time-in-stage, "stage changed this week" filters and audit for free. Salesforce, HubSpot and Twenty all bolt history on per field instead.
- **Build composite types.** Use Twenty's composite shapes for currency, emails, phones, links, name and address.
- **Store money as integers.** Store `amount_micros` (int64) plus a **per-record** `currency_code`, with a per-attribute default currency. Twenty, Salesforce and Pipedrive allow a per-record currency; Attio's per-attribute-only currency is a known limitation.
- **One attribute engine for objects and lists.** Build Attio-style list entries on the same engine from day one.

| Priority | Type (our slug) | Config at launch | Based on |
|---|---|---|---|
| **Launch** | `text` | multiline flag and visible rows (merges text and long text), max length, unique | Attio `text`, Twenty `TEXT.displayedMaxRows` |
| Launch | `number` | int/decimal, decimals, grouping, display variant `number\|percent`, min/max | Twenty `NUMBER` settings, HubSpot rules |
| Launch | `currency` | default currency, per-record code, display (symbol/code/name/narrow), decimals, short/full | Twenty `CURRENCY` + Attio `display_type` |
| Launch | `date`, `timestamp` | display relative/absolute/custom; dynamic defaults `now`, `now+P7D` | Attio defaults, Twenty `displayFormat` |
| Launch | `checkbox` | default | all |
| Launch | `select` with `is_multiselect` | options {title, colour from a fixed palette of about 25, order, archived}; default option; ≤5,000 options | Attio `select`, Twenty options and `TAG_COLORS` |
| Launch | `status` | ordered statuses, each with category (open/won/lost), target time in status, celebration; one per kanban | Attio `status` + SF IsClosed/IsWon |
| Launch | `rating` | max 5 | Attio, Twenty |
| Launch | `email` (multi, with primary) | normalise; store domain and root domain; unique | Attio `email-address` + Twenty `EMAILS` |
| Launch | `phone` (multi, with primary) | E.164, country code, label | Attio + Twenty `PHONES` |
| Launch | `url` / `domain` | variant url\|domain; domain normalised to `root_domain`; multi with labels | Twenty `LINKS`, Attio `domain` |
| Launch | `location` | line1–4, locality, region, postcode, country (ISO α2), lat/lng; choose which subfields show | Attio `location`, Twenty `ADDRESS.subFields` |
| Launch | `person_name` | first, last, full | Attio `personal-name` |
| Launch | `user` (member ref) | single/multi; default `current-user` | Attio `actor-reference` |
| Launch | `actor` (system) | `{type: member\|api_token\|system\|workflow\|import\|email\|calendar\|agent, id, name}`; used by `created_by` and `updated_by` | Twenty `ACTOR` source enum + Attio actor types |
| Launch | `relationship` (two-way) | both slugs, cardinality 1:1/1:n/n:1/n:n, `on_delete` (set null, restrict, cascade), same-object allowed | Attio relationships + Twenty `onDelete` |
| Launch | `record_ref` (one-way) | allowed objects, multi | Attio |
| Launch (system) | `record_id`, `created_at`, `updated_at`, `deleted_at` (soft delete), `position` | read-only | Twenty base fields |
| Launch (system, if email/calendar sync ships) | `interaction` | `{type: email\|meeting, at, owner}`; read-only | Attio `interaction` |
| **Next** | `formula` | same-record expressions; output type; decimals; nesting ≤3 | Attio Formula, HubSpot Calculation |
| Next | `rollup` | count/sum/min/max/avg over a relationship, with a filter | HubSpot Rollup, SF Roll-Up Summary |
| Next | `lookup` | mirror a field from a related record (read-only) | HubSpot Property sync, SF cross-object formula |
| Next | `rich_text` | blocks + markdown | Twenty `RICH_TEXT` |
| Next | `file` | max files and size | Twenty `FILES`, HubSpot File |
| Next | `ai` (a mode on text, number, currency and select, not a separate type) | prompt, sources (web/record/transcripts), manual or bulk run, credit cost | Attio AI autofill, HubSpot Smart properties |
| Next | polymorphic `record_ref` | several allowed objects in one field | Twenty `MORPH_RELATION` |
| **Later** | `json`, `array`, `auto_number`, `time`, `date_range`, `duration`, `encrypted` | — | Twenty, SF, Pipedrive |

Attribute-level features:
- **Launch:** `is_required` (new writes only), `is_unique` (new writes only, with a backfill check), static and dynamic defaults, description/help text, archive and restore (no hard delete in the UI; deleting a select option asks for confirmation because it destroys data), `is_system` and read-only flags, attribute groups on record pages, per-value history.
- **Next:** validation rules (min/max, length, regex, date windows, email/URL domain lists), field permissions per role (view / edit / none), conditional options (a controlling select filters a dependent select), required-by-stage for deals (Pipedrive).

### 5b. Prebuilt attributes for our standard objects

Every object gets these system attributes: `record_id`, `created_at`, `created_by` (actor), `updated_at`, `updated_by` (actor), `deleted_at`, `list_entries` (filter only), `next_due_task`.

**People**

| Slug | Type | Flags | Based on |
|---|---|---|---|
| `name` | person_name | — | all |
| `email_addresses` | email (multi, primary) | **unique**, used for identity and auto-linking to a company by domain | Attio, Twenty |
| `phone_numbers` | phone (multi, labels) | — | Attio, Twenty, Pipedrive |
| `job_title` | text | enrichable | all |
| `company` | relationship n:1 ↔ `companies.team` | auto-set from email domain | Attio |
| `description` | text (multiline) | enrichable | Attio, SF |
| `primary_location` | location | enrichable | Attio, HubSpot, SF |
| `avatar` | url or file | system, enrichable | Attio, Twenty |
| `linkedin`, `twitter`, `facebook`, `instagram`, `angellist` | url | enrichable | Attio, Twenty |
| `owner` | user | optional | HubSpot, SF, Pipedrive (Attio lacks one) |
| `timezone` | text (IANA) | derived from location | HubSpot (company); gap in Attio |
| `email_opt_out` / `marketing_status` | checkbox / select | — | SF `HasOptedOutOfEmail`, Pipedrive `marketing_status` |
| `associated_deals` | relationship n:n ↔ `deals.associated_people` | — | Attio |
| `first_interaction`, `last_interaction`, `next_interaction`, `first_email_interaction`, `last_email_interaction`, `first_calendar_interaction`, `last_calendar_interaction`, `next_calendar_interaction` | interaction | read-only | Attio |
| `connection_strength` | select (our option labels TBD; Attio's option list is UNVERIFIED) | read-only | Attio |
| `strongest_connection` | user | read-only | Attio |

**Companies**

| Slug | Type | Flags | Based on |
|---|---|---|---|
| `name` | text | enrichable | all |
| `domains` | domain (multi) | **unique**, identity key | Attio, Twenty |
| `description` | text (multiline) | enrichable | Attio, HubSpot |
| `logo` | url | system, enrichable | Attio |
| `team` | relationship 1:n ↔ `people.company` | — | Attio, Twenty |
| `categories` / industry | select (multi) | enrichable | Attio, HubSpot, SF |
| `primary_location` | location | enrichable | Attio, Twenty `address` |
| `phone` | phone | — | HubSpot, SF |
| `linkedin`, `twitter`, `facebook`, `instagram`, `angellist` | url | enrichable | Attio, Twenty |
| `employee_range` | select | enrichable | Attio |
| `estimated_arr` | select (ranges) | enrichable | Attio |
| `annual_revenue` | currency | — | Twenty, HubSpot, SF |
| `funding_raised` | currency | enrichable | Attio |
| `foundation_date` | date | enrichable | Attio, HubSpot "Year founded" |
| `owner` | user | — | Twenty `accountOwner`, HubSpot, SF |
| `parent_company` | relationship n:1 ↔ `subsidiaries` (self) | — | HubSpot, SF `ParentId` |
| `associated_deals` | relationship 1:n ↔ `deals.associated_company` | — | Attio, Twenty |
| interactions, `connection_strength`, `strongest_connection` | as for People | read-only | Attio |

**Deals**

| Slug | Type | Flags | Based on |
|---|---|---|---|
| `name` | text | **required** | all |
| `stage` | status (Lead, In progress, Won, Lost; categories open/won/lost) | **required**, default the first status | Attio, SF |
| `owner` | user | **required**, default `current-user` | Attio |
| `value` | currency | per-record currency | all |
| `close_date` (expected) | date | — | Twenty, HubSpot, SF, Pipedrive |
| `probability` | number (percent) | default by stage | HubSpot, SF, Pipedrive |
| `associated_company` | relationship n:1 | — | Attio, Twenty |
| `associated_people` | relationship n:n | — | Attio (Twenty has a single `pointOfContact`) |
| `source` | select | — | SF `LeadSource`, HubSpot |
| `deal_type` | select (New / Existing business) | — | HubSpot, SF `Type` |
| `next_step` | text | — | HubSpot, SF |
| `lost_reason` | select | required when stage = Lost (later) | Pipedrive, HubSpot |
| `won_at`, `lost_at`, `stage_changed_at` | timestamp | system, derived from `stage` history | Pipedrive, SF |
| `description` | text (multiline) | — | HubSpot, SF |
| `weighted_value` | formula (value × probability) | later | HubSpot Weighted amount, SF ExpectedRevenue |
| `time_in_stage`, `days_to_close` | formula/system | later | Attio `timeSpentIn()`, HubSpot |

Users and Workspaces (Attio-style objects for a product's own users and accounts) should be optional objects that are off by default. Users: `user_id` (unique, required), `primary_email` (unique, required), `person` (relationship). Workspaces: `workspace_id` (unique, required), `name`, `users`, `company`, `avatar`.

---

## 6. Sources (URLs actually fetched)

**Attio**
- https://docs.attio.com/docs/attribute-types
- https://docs.attio.com/llms.txt
- https://docs.attio.com/rest-api/attribute-types/attribute-types.md
- https://docs.attio.com/rest-api/attribute-types/attribute-types-{actor-reference, checkbox, currency, date, domain, email-address, interaction, location, personal-name, number, phone-number, rating, record-reference, select, status, text, timestamp}.md (each page fetched)
- https://docs.attio.com/rest-api/attribute-types/attribute-types-currency
- https://docs.attio.com/rest-api/attribute-types/attribute-types-record-reference
- https://docs.attio.com/rest-api/attribute-types/attribute-types-interaction
- https://docs.attio.com/rest-api/attribute-types/attribute-types-actor-reference
- https://docs.attio.com/docs/standard-objects/standard-objects-people (and `.md`)
- https://docs.attio.com/docs/standard-objects/standard-objects-companies.md
- https://docs.attio.com/docs/standard-objects/standard-objects-deals.md
- https://docs.attio.com/docs/standard-objects/standard-objects-users.md
- https://docs.attio.com/docs/standard-objects/standard-objects-workspaces.md
- https://docs.attio.com/docs/default-values.md
- https://docs.attio.com/docs/objects-and-lists.md
- https://docs.attio.com/docs/archiving-vs-deleting.md
- https://docs.attio.com/rest-api/endpoint-reference/attributes/create-an-attribute.md
- https://docs.attio.com/rest-api/endpoint-reference/lists/create-a-list.md
- https://attio.com/help/reference/workspace/attributes
- https://attio.com/help/reference/managing-your-data/attributes/create-manage-attributes
- https://attio.com/help/reference/managing-your-data/attributes/formula-attributes
- https://attio.com/help/reference/managing-your-data/attributes/ai-attributes
- https://attio.com/help/reference/managing-your-data/attributes/relationship-attributes
- https://attio.com/help/reference/managing-your-data/enriched-data
- https://attio.com/help/reference/attio-101/productivity/communications-intelligence
- https://attio.com/help/reference/attio-101/attios-data-model/understanding-lists
- https://attio.com/help/reference/managing-your-data/objects/manage-standard-objects

**Twenty**
- https://raw.githubusercontent.com/twentyhq/twenty/main/packages/twenty-shared/src/types/FieldMetadataType.ts
- …/twenty-shared/src/types/{FieldMetadataSettings, FieldMetadataOptions, FieldMetadataDefaultValue, RelationOnDeleteAction, RelationType, FieldMetadataMultiItemSettings, AddressFieldsType, CompositeFieldSubFieldNameType, TagColor}.ts
- …/twenty-shared/src/constants/TagColors.ts
- …/twenty-shared/src/types/composite-types/actor.composite-type.ts
- …/twenty-server/src/modules/{person, company, opportunity, task, note, workspace-member}/standard-objects/*.workspace-entity.ts
- …/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/field-metadata/compute-{person, company, opportunity, task, note, workspace-member, task-target}-standard-flat-field-metadata.util.ts
- …/twenty-server/src/engine/metadata-modules/field-metadata/field-metadata.entity.ts
- https://api.github.com/repos/twentyhq/twenty/git/trees/main?recursive=1
- https://api.github.com/repos/twentyhq/twenty/releases?per_page=5
- https://api.github.com/repos/twentyhq/twenty/contents/packages/twenty-server/src/engine/workspace-manager/twenty-standard-application/utils/field-metadata
- https://docs.twenty.com/user-guide/data-model/capabilities/fields
- https://docs.twenty.com/user-guide/data-model/capabilities/relation-fields
- https://docs.twenty.com/user-guide/data-model/how-tos/data-model-faq
- https://docs.twenty.com/user-guide/permissions-access/capabilities/permissions

**HubSpot**
- https://knowledge.hubspot.com/properties/property-field-types-in-hubspot
- https://knowledge.hubspot.com/properties/hubspots-default-contact-properties
- https://knowledge.hubspot.com/properties/hubspot-crm-default-company-properties
- https://knowledge.hubspot.com/properties/hubspots-default-deal-properties
- https://knowledge.hubspot.com/properties/create-and-edit-properties
- https://knowledge.hubspot.com/properties/set-validation-rules-for-properties
- https://knowledge.hubspot.com/properties/restrict-view-edit-access-for-properties
- https://knowledge.hubspot.com/properties/organize-and-export-properties
- https://knowledge.hubspot.com/properties/set-up-conditional-options-for-properties
- https://knowledge.hubspot.com/object-settings/create-and-use-association-labels
- https://developers.hubspot.com/docs/api-reference/legacy/crm/properties/guide
- https://developers.hubspot.com/docs/api-reference/crm-associations-v4/guide
- Tried but failed: https://developers.hubspot.com/docs/api-reference/crm-properties-v3/guide (HTTP 500) and https://knowledge.hubspot.com/properties/set-up-conditional-logic-for-properties (404)
- Seen in search results only, not fetched: https://knowledge.hubspot.com/properties/create-smart-properties

**Salesforce**
- https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf (Metadata API Developer Guide v68.0: CustomField, FieldType, ValueSet, ValidationRule, PermissionSetFieldPermissions)
- https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf (Object Reference v68.0: Field Types, System Fields, Relationships, Account, Contact, Opportunity, AccountContactRelation)
- https://trailhead.salesforce.com/content/learn/modules/data_modeling/object_relationships
- Tried but not readable: https://help.salesforce.com/s/articleView?id=platform.custom_field_types.htm&type=5 (renders with JavaScript), https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm and https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/field_types.htm (both HTTP 403)

**Pipedrive**
- https://support.pipedrive.com/en/article/what-types-of-custom-fields-are-there
- https://support.pipedrive.com/en/article/custom-fields
- https://support.pipedrive.com/en/article/data-fields-in-pipedrive
- https://support.pipedrive.com/en/article/field-groups
- https://support.pipedrive.com/en/article/required-fields
- https://support.pipedrive.com/en/article/how-can-i-add-related-people-or-organizations-to-a-deal
- https://developers.pipedrive.com/docs/api/v1/DealFields
- https://developers.pipedrive.com/docs/api/v1/Deals
- https://developers.pipedrive.com/docs/api/v1/Persons
- https://developers.pipedrive.com/docs/api/v1/Organizations
- Seen in search results only, not fetched: https://support.pipedrive.com/en/article/custom-fields-formula-fields

**Not researched:** Folk and Zoho, left out to save time.
