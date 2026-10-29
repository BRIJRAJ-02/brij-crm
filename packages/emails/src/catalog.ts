// Every email the product sends, in one list: each queued kind's template,
// the footer link's `utm_medium`, and sample params the preview and the
// tests draw it with. Whether a member can turn a kind off (its topic) is
// the contract's `EMAIL_KIND_TOPICS`, read through `topicOf`.
import { EMAIL_KIND_TOPICS, type EmailKind, type EmailParams, type EmailTopic } from '@crm/contracts/emails';
import type { EmailMedium } from './links.ts';
import type { Template } from './template.ts';
import { bookingCalendarRemoved, calendarDisconnected, signInAlert } from './templates/account.ts';
import { formConfirmation, formSubmission } from './templates/forms.ts';
import { memberInvite } from './templates/invite.ts';
import { importFinished, jobFailed } from './templates/team.ts';
import { workspaceWelcome } from './templates/welcome.ts';

/** One queued kind of email. */
export interface CatalogEntry<K extends EmailKind> {
  readonly template: Template<EmailParams[K]>;
  /** The footer link's `utm_medium`. */
  readonly medium: EmailMedium;
  /** What it looks like with plausible params: the preview's and the tests'. */
  readonly sample: EmailParams[K];
}

/** Every queued kind of email. */
export type Catalog = { readonly [K in EmailKind]: CatalogEntry<K> };

/** A fixed moment for samples: they draw the same every time. */
const AT = '2026-10-21T13:05:00.000Z';

/** Every queued kind of email, with its template and samples. */
export const CATALOG: Catalog = {
  form_submission: {
    template: formSubmission,
    medium: 'email_form_notice',
    sample: {
      formName: 'Contact us',
      submitter: { name: 'Asha Rao', email: 'asha@northwind.example' },
      answers: [
        { label: 'Company', value: 'Northwind Trading' },
        { label: 'How many people are on your team?', value: '11 to 50' },
        {
          label: 'What can we help with?',
          value:
            'We book about 40 demos a week and want round robin across three reps.\nCan we try it on one team first?',
        },
      ],
      submittedAt: AT,
      timeZone: 'Europe/London',
      submissionPath: '/w/acme/captures/forms/0199f1d2-7c3a-7cc1-9a51-0d5f1e2a3b4c',
    },
  },
  form_confirmation: {
    template: formConfirmation,
    medium: 'email_form_confirmation',
    sample: {
      formName: 'Contact us',
      message: 'Thanks for getting in touch. Someone from the team will reply within one working day.',
      answers: [
        { label: 'Name', value: 'Asha Rao' },
        { label: 'What can we help with?', value: 'We want round robin across three reps.' },
      ],
      submittedAt: AT,
      timeZone: 'Europe/London',
    },
  },
  calendar_disconnected: {
    template: calendarDisconnected,
    medium: 'email_calendar_alert',
    sample: {
      provider: 'google',
      accountEmail: 'ada@acme.example',
      reason: 'expired',
      settingsPath: '/w/acme/settings/scheduling/calendars',
    },
  },
  booking_calendar_removed: {
    template: bookingCalendarRemoved,
    medium: 'email_booking',
    sample: {
      title: 'Intro call',
      guestName: 'Asha Rao',
      guestEmail: 'asha@northwind.example',
      startsAt: '2026-11-02T09:00:00.000Z',
      endsAt: '2026-11-02T09:30:00.000Z',
      timeZone: 'Europe/London',
      bookingsPath: '/w/acme/bookings/list',
    },
  },
  member_invite: {
    template: memberInvite,
    medium: 'email_invite',
    sample: {
      inviterName: 'Ada Lovelace',
      role: 'member',
      acceptPath: '/invite/sample-token-for-the-preview',
      expiresAt: '2026-10-28T13:05:00.000Z',
    },
  },
  sign_in_alert: {
    template: signInAlert,
    medium: 'email_sign_in_alert',
    sample: {
      signedInAt: AT,
      timeZone: 'Europe/London',
      device: 'Chrome on macOS',
      place: 'London, United Kingdom',
      method: 'code',
      securityPath: '/settings/account/sign-in',
    },
  },
  import_finished: {
    template: importFinished,
    medium: 'email_import',
    sample: {
      objectName: 'People',
      fileName: 'conference-leads.csv',
      outcome: 'done',
      created: 1204,
      updated: 87,
      skipped: 12,
      failed: 0,
      resultPath: '/w/acme/objects/people',
    },
  },
  job_failed: {
    template: jobFailed,
    medium: 'email_job',
    sample: {
      jobLabel: 'Bulk edit',
      reason: 'This job stopped after repeated errors. What it finished is kept.',
      jobsPath: '/w/acme/settings/jobs',
    },
  },
  workspace_welcome: {
    template: workspaceWelcome,
    medium: 'email_invite',
    sample: {
      openPath: '/w/acme',
      linkPage: { handle: 'ada-lovelace', editPath: '/w/acme/link-page' },
    },
  },
};

/** A kind's topic, when a member can turn it off. */
export function topicOf(kind: EmailKind): EmailTopic | undefined {
  return EMAIL_KIND_TOPICS[kind];
}
