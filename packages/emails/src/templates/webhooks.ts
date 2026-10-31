// A webhook endpoint the workspace stopped sending to (spec 0064, AC-6423): every delivery to it failed for 3 days.
// To each owner and admin: which endpoint, what happened, and the one switch that turns it back on.
import type { WebhookEndpointOffEmail } from '@crm/contracts/emails';
import { workspaceOf, type Template } from '../template.ts';

/** An endpoint turned off after 3 days of failed deliveries. */
export const webhookEndpointOff: Template<WebhookEndpointOffEmail> = (params, context) => {
  const subject = 'A webhook endpoint was turned off';
  return {
    subject,
    preheader: `Every delivery to ${params.endpoint} failed for 3 days.`,
    eyebrow: workspaceOf(context),
    heading: subject,
    blocks: [
      {
        type: 'paragraph',
        text: `Every delivery to ${params.endpoint} failed for 3 days, so Timefix stopped sending to it. Fix the receiver, then turn the endpoint back on.`,
      },
      { type: 'button', label: 'Open Webhooks', url: context.link(params.settingsPath) },
    ],
    why: `You got this email because you are an owner or admin of ${workspaceOf(context)}.`,
  };
};
