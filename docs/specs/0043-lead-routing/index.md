# 0043. Lead routing: one rule format for forms and team booking pages, and Show when on questions

**Date**: 2026-10-22
**Status**: Proposed
**Feature**: #58 Round robin assignment (rules first routing), #48 Forms (Show when and routing, the revision in [0023-types-and-logic.md](../0023-forms/0023-types-and-logic.md), AC-1036 to AC-1039 and AC-1049 to AC-1051), #59 team booking pages
**Builds on**: [0029](../0029-round-robin-booking/index.md) (rotations), round 7's form hand off to a booking page (spec 0023, AC-1055 to AC-1058)
**Relates to**: spec 0037's [0037-routing.md](../0037-team-scheduling-access/0037-routing.md) (not yet landed). This spec is its first, smaller slice: the same condition shape (`ShowWhen`, evaluated by `matchesShowWhen`), the visitor rule and host rule split, and rules per form and per team page in place of one workspace routing setup. Smart ranking, holdouts and learned lift stay in 0037. Rules per surface are accepted for now (coordinator, 22 October 2026); a workspace wide routing setup holding the same rules can come later.

## Summary

The owner asked for smart round robin "by lead qualification and meeting type, trained, one format" (21 October 2026). The coordinator decided the shape, under the owner's delegation of design calls:

- **One format.** Forms and team booking pages share one routing format: an ordered list of rules, each "when these answers or fields match, then this route", first match wins, and a fallback when none does. The fallback is the surface's own setting: a form's **After someone sends it**, a team page's whole rotation.
- **Conditions** read the visitor's answers and known record fields (the person's and their company's: company size, country, industry, any select), with one to five comparisons joined by all or any. A form's rules read answers; a team page's rules read record fields and the answers of the form that sent the visitor, and only ever choose among hosts.
- **Routes**: on a form, a booking page (a team page books from its round robin pool), optionally only some of its rotation's members (one member is a specific host), or a thank you message, or a web page. On a team page, some of its rotation's members.
- **Qualification**: a rule can mark the lead Qualified or Not qualified; the meeting type is the booking page it sends to, so a lead that isn't qualified goes to a message or a shorter meeting.
- **"Trained"** means each rule has a report (how many leads it matched, how many booked, how many didn't show), so admins tune rules by what happened. No machine learning.
- **Show when**: each form question can show only when earlier answers match. A hidden question is skipped, never required, and its answer is not stored.

Reasoning and options: see [rationale.md](rationale.md).

## Acceptance criteria

*The format*
- **AC-1601**: A routing rule is `{ id, name?, when, then, qualified? }`. `when` is spec 0023's `ShowWhen` (`join: all | any`, 1 to 5 conditions `{ key, op, value? }`); `then` is a route; `qualified` is true, false or absent. A surface holds 0 to 20 rules. Rules are tried in order; the first whose `when` matches decides; none matching means the fallback.
- **AC-1602**: Operators: is, is not, is any of, contains, is answered, is empty, more than, less than. Text compares trimmed and without case; yes or no answers compare as yes and no; a fact holding several values matches `is` when any value does and `is not` when none does. A condition on a fact that can't be read (a field archived, a record not found) is false, never true, and the decision says which rule was skipped.
- **AC-1603**: Fact keys: a question key (`budget`), `person.<attributeId>` or `company.<attributeId>` (a field of the person matched by the visitor's email, or of that person's company). Record facts read select options by option id, so renaming an option changes no rule.

*Forms*
- **AC-1604**: A form's document gains `routing: { rules }`, saved in the draft and live from the next publish, like **After someone sends it**. Its routes are `book` (a booking page id, and for a team page optionally `hosts`, 1 to 8 members of its rotations), `message` (text) and `redirect` (an https address). A form's rules read its answers only. Record facts are read by the team page's own rules when the host is chosen (AC-1610), so a visitor's next step never depends on what the CRM knows about them.
- **AC-1605**: Publish refuses, in one sentence each: a condition on a question that isn't on the form or comes after another it depends on, a choice that no longer exists, a booking page that is gone, paused or not the publisher's to use, hosts on a personal page, and a host who isn't in the page's rotations.
- **AC-1606**: At submit the server decides the route from the checked answers and returns it as the visitor's next step: a booking route answers round 7's `{ kind: 'booking', url, countdownSeconds, text }` with the signed hand off, a message or redirect as before. A spam or held submission answers the fallback and records no decision.
- **AC-1607**: Each routed submission stores one decision row: the rule (or the fallback), its qualification, the page and hosts it routed to. The submission's panel shows "Rule 2, Enterprise: Qualified, sent to Intro call with Sam Lee or Bea Diaz".

*Team booking pages*
- **AC-1608**: A round robin page's editor has a **Routing** card: rules whose route is `hosts` (1 to 8 members of the page's rotations), whose conditions read record facts and, when the visitor came from a form, that form's answers. Saved with the page (`booking_admin`), audited.
- **AC-1609**: A visitor arriving through a form hand off that chose hosts sees only times when one of those hosts is free, and the booking goes to one of them by the rotation's own rules (fair, priority, even, caps).
- **AC-1610**: At booking, the page's own rules are tried on the visitor's facts: the first match narrows the rotation to its hosts among those free at the slot; if none of them is free, the whole rotation picks (the fallback), and the decision says so. Rules never refuse a booking.
- **AC-1611**: Each team page booking stores one decision row (rule or fallback, qualification, hosts) linked to the booking.

*Report*
- **AC-1612**: The form's Settings and the team page's Routing card show a **Report** per rule and for the fallback over the last 30 or 90 days: matched, booked, didn't show, and qualified, with the booked and no show shares. Only those who may edit the surface see it.
- **AC-1613**: A host or a booking admin can mark a past booking **No show** from its menu, and undo it; the change is audited and feeds the report.

*Show when*
- **AC-1614**: A question can have **Show when** (AC-1036's shape) over earlier questions. One pure function `visibleQuestions(questions, answers)` in `packages/contracts` decides what shows on the hosted page, in Steps, in the builder's preview and in `checkAnswers` on the server. A hidden question is never required and its answer is dropped; a step whose questions are all hidden is skipped.
- **AC-1615**: The builder's open question card has a **Show when** row (a question Select, an operator Select, a value Select or Field, all or any, up to 5), and a closed card says "Shows when Budget is Over $10k".

*Rules for every write*
- **AC-1616**: Every write here goes through the access door (`forms.manage` for a form, `booking.admin` for a team page, the host or `booking.admin` for No show), runs in one transaction with its audit row (`routing.changed`, `booking.no_show`, `booking.no_show_undone`), and is refused with the standard `{ code, message }` shape. `routing_decisions` forces row level security per workspace, and a cross workspace read returns nothing.

## Design

```
contracts  forms/show-when.ts   ShowWhen, matchesShowWhen, visibleQuestions (no Zod; the hosted page uses it)
           routing.ts           RoutingRule, Route, RoutingRules, RoutingReport, the routing contract
core       routing/decide.ts    decideRoute(rules, facts) -> { ruleId | undefined, route, qualified, skipped }
           routing/facts.ts     record facts by email (person, company), read inside the write
           routing/report.ts    per rule counts from routing_decisions joined to bookings
db         routing_decisions    one row per decision (forced RLS); bookings.no_show_at, no_show_by_member_id
           booking_pages.routing (jsonb rules); forms keep theirs in the version document
```

- **Form submit**: `submitForm` runs `decideRoute` over the checked answers before storing; the decision row is written in the same transaction; the hand off token gains the decision id so the booking page reads its hosts.
- **Slots and booking**: the hand off token now also rides the slots request; a valid one with hosts narrows the team (`narrowTeam`) for slots and for `chooseHosts` through its `allow` hook. The page's own rules run inside `bookPublicSlot`, under the rotation lock, after the guest's facts are read.
- **Screens**: Settings tab: a **Routing** card under After someone sends it (an ordered list of rule rows, each edited in a Modal with the Show when builder and a route picker; a Report table). Team page editor: a **Routing** card with the same rule rows and Report. Questions: the Show when row. Bookings: No show in the row menu. Library components only.

## Numbers

20 rules a surface, 5 conditions a rule, 8 hosts a route; record facts are read for at most 10 attributes per decision in one query; the report reads one indexed range of decisions per surface (`routing_decisions (workspace_id, surface_id, decided_at)`).

## Follow ups

Workspace wide routing setup (the same rules, held once for the workspace), reading record fields only for a visitor whose email is vouched for (a signed in guest, spec 0028), smart ranking, skills, holdouts and learning (spec 0037); routing for leads that don't book (owner assignment, 0023 AC-1050); hidden field and UTM facts; a drawn chart in the report.
