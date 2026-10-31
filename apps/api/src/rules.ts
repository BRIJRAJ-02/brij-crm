// Where this app reads object, field and record rules, and a member's teams (specs 0009, 0031 and 0032): the api's
// door for every request and the worker's re-entry for every slice of a member's job take them from here, so a job
// never runs with less than its member's rules. Tests inject their own.
import { storedRules, type RuleSource } from '@crm/core';

/** The rules every member's requests and background jobs run under: the stored ones, with the member's teams. */
export const APP_RULES: RuleSource = storedRules;
