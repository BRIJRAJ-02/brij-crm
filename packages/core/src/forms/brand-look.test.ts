// The form's Brand look end to end against a real Postgres (spec 0063, AC-6327): a new form is made wearing the
// workspace's brand kit, the live read says so, and a form moved to Plain says so instead, so the hosted page knows
// which one to wear. The publish path reads the kit through `brandRowOf` inside the form's own workspace
// transaction, so spec 0060's contrast guard runs here and not only on the brand kit's own screen.
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { createObject } from '../objects/objects.ts';
import { saveWorkspaceBrand } from '../brand/brand.ts';
import { newId } from '../engine/ids.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { createForm, publishForm, saveFormDraft, setFormTarget } from './forms.ts';
import { getPublicForm } from './public.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-form-brand-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;

/** A workspace with an object a form can file onto, and a form filing its email question onto it. */
async function workspaceWithForm() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Brand',
    slug: `brand-look-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const object = await createObject(scope, {
    id: newId(),
    singularName: 'Lead',
    pluralName: 'Leads',
    icon: 'inbox',
    hue: 'blue',
  });
  const email = await createAttribute(scope, {
    objectId: object.id,
    id: newId(),
    title: 'Work email',
    type: 'email',
    isUnique: true,
  });
  const form = await createForm(scope, { id: newId(), name: 'Enquiry', mainObjectId: object.id });
  const targeted = await setFormTarget(scope, {
    formId: form.id,
    mainObjectId: object.id,
    expectedRevision: form.revision,
  });
  const document = {
    ...targeted.draft,
    questions: targeted.draft.questions.flatMap((each) =>
      each.answerType === 'email'
        ? [{ ...each, required: true, filedOn: { objectRole: 'main' as const, attributeId: email.id } }]
        : [],
    ),
  };
  const saved = await saveFormDraft(scope, { formId: form.id, document, expectedRevision: targeted.revision });
  /** The form as its own address reads it: the scope the hosted page's read runs in. */
  const asVisitor = async () => {
    const entry = await enterPublicForm({ db }, form.publicKey);
    return getPublicForm(entry.scope, { formId: entry.formId });
  };
  return { scope, formId: form.id, revision: saved.revision, draft: document, asVisitor };
}

it('makes a new form wearing the workspace brand kit, and says so in the live read (AC-6327)', async () => {
  const w = await workspaceWithForm();
  expect(w.draft.look.theme).toBe('brand');
  await saveWorkspaceBrand(w.scope, { accent: '#1f5fd6', accentDark: null });
  const published = await publishForm(w.scope, { formId: w.formId, expectedRevision: w.revision });
  const live = await w.asVisitor();
  expect(live.look.theme).toBe('brand');
  expect(published.status).toBe('live');
});

it('says Plain for a form whose look was moved off the kit, whatever the workspace saved (AC-6327)', async () => {
  const w = await workspaceWithForm();
  await saveWorkspaceBrand(w.scope, { accent: '#1f5fd6', accentDark: null });
  const plain = await saveFormDraft(w.scope, {
    formId: w.formId,
    document: { ...w.draft, look: { ...w.draft.look, theme: 'plain' as const } },
    expectedRevision: w.revision,
  });
  await publishForm(w.scope, { formId: w.formId, expectedRevision: plain.revision });
  const live = await w.asVisitor();
  expect(live.look.theme).toBe('plain');
});

it('publishes a Brand form on a workspace that saved no colour (AC-6327)', async () => {
  const w = await workspaceWithForm();
  await publishForm(w.scope, { formId: w.formId, expectedRevision: w.revision });
  const live = await w.asVisitor();
  expect(live.look.theme).toBe('brand');
});
