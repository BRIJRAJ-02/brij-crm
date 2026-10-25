// Email signup's hosted form (spec 0052, AC-5217), kept out of the first load. The link page editor is the only
// screen that makes one, and that editor loads on use, so this loads with it: `index.ts` reaches it with an
// `import()` rather than carrying its three writes into every first visit (`apps/web/.size-limit.js`).
import type {
  CreateFormInput,
  FormSummary,
  FormView,
  Me,
  ProfileFormChoice,
  PublishFormInput,
  SaveFormDraftInput,
} from '@crm/contracts';
import type { CaptureListStore } from '../captures/list.ts';

/** What the form is called, and the two words its page shows: the heading above it and its button. */
export interface SignupFacts {
  readonly name: string;
  readonly headline: string;
  readonly buttonText: string;
}

/** What making one needs from the layer: the three writes, the forms list they go through, and who is signed in. */
export interface SignupDeps {
  readonly forms: {
    readonly create: (input: CreateFormInput) => Promise<FormView>;
    readonly saveDraft: (input: SaveFormDraftInput) => Promise<FormView>;
    readonly publish: (input: PublishFormInput) => Promise<FormView>;
  };
  /** The one copy of the forms list every form write patches, so Captures learns about this one too. */
  readonly lists: CaptureListStore<FormSummary>;
  readonly landForm: (formId: string) => (items: readonly FormSummary[], form: FormView) => readonly FormSummary[];
  readonly mintId: () => string;
  readonly readMe: () => Promise<Me | undefined>;
}

/**
 * Email signup (spec 0052, AC-5217): makes a hosted form that asks one thing, an address, and publishes it, so the
 * link page editor can add an ordinary form block pointing at it. It is not a kind of its own, and the addresses
 * land in that form's responses, where every other capture on Timefix already lands, so the person's routing,
 * notifications and export work on them unchanged.
 *
 * The form keeps its submissions only (`targets: {}`), which is what lets it be made in any workspace without
 * asking which object to file against. Three calls, in order: make it, write its one question, publish it. Each
 * goes through the same write path Captures uses, so the forms list learns about it without being read again.
 */
export async function makeSignupForm(
  deps: SignupDeps,
  workspace: string,
  input: SignupFacts,
): Promise<ProfileFormChoice> {
  const { forms, lists, landForm, mintId, readMe } = deps;
  const made = await lists.write(workspace, {
    send: () => forms.create({ workspace, id: mintId(), name: input.name, mainObjectId: null, mutationId: mintId() }),
    land: (items, form) => landForm(form.id)(items, form),
  });
  const saved = await lists.write(workspace, {
    send: () =>
      forms.saveDraft({
        workspace,
        formId: made.id,
        document: {
          ...made.draft,
          // The one question a signup form asks. Written here rather than imported from the contracts: that module
          // builds the document's Zod schema, and Zod must stay out of this package's static graph either way.
          questions: [
            {
              id: 'email',
              key: 'email',
              label: 'Email',
              answerType: 'email',
              placeholder: 'you@example.com',
              required: true,
              update: 'fill',
            },
          ],
          targets: {},
          headline: input.headline,
          buttonText: input.buttonText,
        },
        expectedRevision: made.revision,
        mutationId: mintId(),
      }),
    land: landForm(made.id),
  });
  const live = await lists.write(workspace, {
    send: () =>
      forms.publish({
        workspace,
        formId: made.id,
        expectedRevision: saved.revision,
        name: input.name,
        mutationId: mintId(),
      }),
    land: landForm(made.id),
  });
  const held = await readMe().catch(() => undefined);
  const inside = held?.workspaces.find((each) => each.slug === workspace);
  return {
    workspaceId: inside?.id ?? live.id,
    formId: live.id,
    facts: {
      name: live.name,
      key: live.publicKey,
      workspaceName: inside?.name ?? workspace,
      workspaceSlug: workspace,
      status: live.status === 'live' ? 'live' : 'paused',
    },
  };
}
