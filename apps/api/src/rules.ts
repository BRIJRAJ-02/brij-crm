// Where this app reads object, field and record rules (spec 0009): the api's
// door for every request and the worker's re-entry for every slice of a
// member's job take them from here, so a job never runs with less than its
// member's rules. None until #24 stores them; tests inject their own.
import { NO_RULE_SOURCE, type RuleSource } from '@crm/core';

/** The rules every member's requests and background jobs run under: none yet (#24 stores them). */
export const APP_RULES: RuleSource = NO_RULE_SOURCE;
