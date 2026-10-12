// A select's or status attribute's options as settings shape them (spec 0012,
// AC-236, AC-237): create with a client id, change, move, archive and
// restore. Options travel inline on their attribute's definition
// (`AttributeOption`); these are the writes.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { AttributeOption, OptionLabel, OptionOutcome, TargetDays } from './attributes.ts';
import { Hue } from './values/hues.ts';
import { WorkspaceScoped } from './workspaces.ts';

/**
 * A new option at the end of a select or status attribute's options. `id` is
 * a UUID v7 the browser mints and the retry key. `hue` is the one after the
 * last option's (`nextHue`) when absent. `outcome` (open when absent) and
 * `targetTimeInStage` are for status stages only.
 */
export const CreateOptionInput = WorkspaceScoped.extend({
  attributeId: z.uuid(),
  id: z.uuid({ version: 'v7', message: 'The option id must be a UUID v7.' }),
  label: OptionLabel,
  hue: Hue.optional(),
  outcome: OptionOutcome.optional(),
  targetTimeInStage: TargetDays.optional(),
  mutationId: z.uuid(),
});
/** A new option. */
export type CreateOptionInput = z.infer<typeof CreateOptionInput>;

/** An option's label, hue, or a stage's outcome or target time, changed; `null` clears the target time. */
export const UpdateOptionInput = WorkspaceScoped.extend({
  optionId: z.uuid(),
  label: OptionLabel.optional(),
  hue: Hue.optional(),
  outcome: OptionOutcome.optional(),
  targetTimeInStage: TargetDays.nullable().optional(),
  mutationId: z.uuid(),
});
/** An option, changed. */
export type UpdateOptionInput = z.infer<typeof UpdateOptionInput>;

/** An option moved to `position` in its attribute's order, archived options counted. */
export const ReorderOptionInput = WorkspaceScoped.extend({
  optionId: z.uuid(),
  position: z.number().int().min(0),
  mutationId: z.uuid(),
});
/** An option moved. */
export type ReorderOptionInput = z.infer<typeof ReorderOptionInput>;

/** One option to archive or restore. */
export const OptionWriteInput = WorkspaceScoped.extend({
  optionId: z.uuid(),
  mutationId: z.uuid(),
});
/** One option to archive or restore. */
export type OptionWriteInput = z.infer<typeof OptionWriteInput>;

/**
 * An attribute's options (spec 0012). Every write needs `schema.manage` (403
 * `FORBIDDEN`), waits for the server and stores one `definitions` event for
 * the attribute's object. `create` refuses `LIMIT_REACHED` at 500 live
 * options, `ID_TAKEN`, and `CONFIG_INVALID` (a label a live option of the
 * attribute holds, ignoring case, on `label`; an attribute that takes no
 * options); repeating a `create` whose answer was lost answers the option it
 * made. `reorder` answers the attribute's options, archived ones included, in
 * their new order. `archive` keeps the option on the values that hold it and
 * refuses it for new ones (`OPTION_ARCHIVED`); `restore` refuses
 * `LIMIT_REACHED` while 500 are live, and `CONFIG_INVALID` on `label` when a
 * live option took its label meanwhile. An unknown or hidden attribute or
 * option is 404 `NOT_FOUND`.
 */
export const optionsContract = {
  create: oc.input(CreateOptionInput).output(AttributeOption),
  update: oc.input(UpdateOptionInput).output(AttributeOption),
  reorder: oc.input(ReorderOptionInput).output(z.array(AttributeOption)),
  archive: oc.input(OptionWriteInput).output(AttributeOption),
  restore: oc.input(OptionWriteInput).output(AttributeOption),
};
