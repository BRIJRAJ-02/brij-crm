# Intelligence

The CRM doing work for you: automations, the AI assistant, and AI attributes. All of it comes after the first release. See [index.md](index.md) for the house rules and the full order.

## Slice 19: Automations

### 53. Automations · needs a decision
Let the CRM do routine work: when something happens, do something.
**Done when:** an admin builds an automation from a trigger (record created, field changed, added to a list, on a schedule), conditions, and actions (set a field, create a record or task, send a notification, a webhook or an email); a new automation runs as a dry run first, showing what it would have done; every run has a history; runs count against the plan.
- [ ] Design it (spec): `/architect automations`

## Slice 20: AI

### 54. AI assistant · needs a decision
Ask questions about your data in plain words, and have the assistant propose changes you confirm.
**Done when:** answers only use data the asker may see; every proposed change shows before and after, and applies only on confirm through the same access check as the screens; each applied change can be undone.
- [ ] Design it (spec): `/architect AI assistant`

### 55. AI attributes · needs a decision
Attributes the AI fills in for you: classify a company, summarise a thread, research a person.
**Done when:** an admin creates an AI attribute with a prompt and a result type (text, select or number); it fills on new records and can backfill existing ones in the background; each value shows where it came from and can be corrected by hand; usage counts against the plan.
- [ ] Design it (spec): `/architect AI attributes`
