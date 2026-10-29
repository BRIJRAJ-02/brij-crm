// Email signup's hosted form (spec 0052, AC-5217): made, given its one question and published, in that order, and
// thanking a subscriber as one, not as an enquiry the team will answer (crm-f7's link page walk, 28 Oct 2026).
import type { FormView, SaveFormDraftInput } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { makeSignupForm, SIGNUP_THANKS, type SignupDeps } from './signup-form.ts';

const FORM = '0199f0a0-0000-7000-8000-0000000000f1';

/** A form as the server answers each write: enough of it for the three calls. */
const view = (revision: number, status: 'draft' | 'live' = 'draft') =>
  ({
    id: FORM,
    name: 'Newsletter',
    status,
    revision,
    publicKey: 'news',
    draft: { questions: [], targets: {} },
  }) as unknown as FormView;

describe('Email signup’s form', () => {
  it('thanks a subscriber as one, and asks only an address', async () => {
    const drafts: SaveFormDraftInput[] = [];
    const deps: SignupDeps = {
      forms: {
        create: () => Promise.resolve(view(1)),
        saveDraft: (input) => {
          drafts.push(input);
          return Promise.resolve(view(2));
        },
        publish: () => Promise.resolve(view(3, 'live')),
      },
      // Every write goes straight to the server here: what the list shows meanwhile isn't this test's.
      lists: {
        write: (_workspace: string, write: { readonly send: () => Promise<FormView> }) => write.send(),
      } as unknown as SignupDeps['lists'],
      landForm: () => (items) => items,
      mintId: () => '0199f0a0-0000-7000-8000-0000000000aa',
      readMe: () => Promise.resolve(undefined),
    };
    await makeSignupForm(deps, 'acme', { name: 'Newsletter', headline: 'Get the news', buttonText: 'Sign up' });
    const [draft] = drafts;
    expect(draft?.document.after).toEqual({ kind: 'message', message: SIGNUP_THANKS });
    expect(draft?.document.questions.map((question) => question.answerType)).toEqual(['email']);
    expect(SIGNUP_THANKS).not.toMatch(/come back to you/);
  });
});
