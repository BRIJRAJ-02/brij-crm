// Who may sign up (spec 0005, AC-29): emails on SIGNUP_ALLOWLIST, until plans
// exist. Locally an unset list means anyone; in previews and production an
// unset list means no one new. An existing user is never asked.
import type { AppEnvironment } from '@crm/contracts';

/** Whether a new account may be made for an email. */
export interface Allowlist {
  /** True when anyone may sign up (a laptop with no list). */
  readonly open: boolean;
  /** True when a new account may be made for `email` (compared lowercased). */
  allows(email: string): boolean;
}

/** The allowlist for this environment: the listed emails, or everyone locally when there is no list. */
export function createAllowlist(environment: AppEnvironment, emails: readonly string[] | undefined): Allowlist {
  const open = emails === undefined && environment === 'local';
  const listed = new Set((emails ?? []).map((email) => email.trim().toLowerCase()));
  return {
    open,
    allows: (email) => open || listed.has(email.trim().toLowerCase()),
  };
}
