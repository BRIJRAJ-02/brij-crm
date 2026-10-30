// Moving the records that hold an option to another one, as its Archive asks (flow pass, 30 October 2026): one
// bulk edit job over every record matching "<attribute> is <option>", through the data layer's bulk path (spec
// 0022), confirmed by itself once counted, since the person already chose the move in the option's menu.
import type { DataLayer } from '@crm/data';

/** What the move needs: the attribute, the option its records leave and the one they go to. */
export interface OptionMove {
  readonly objectId: string;
  readonly attributeId: string;
  readonly from: string;
  readonly to: string;
}

/** Statuses after which a job will never wait for its confirm. */
const PAST_READY: ReadonlySet<string> = new Set(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']);

/** Starts the move and confirms it once counted; rejects with the refusal when it can't start. */
export async function moveOptionRecords(data: DataLayer, slug: string, move: OptionMove): Promise<void> {
  const id = data.jobs.newId();
  const job = await data.records.startBulk(slug, {
    id,
    action: 'edit',
    target: {
      kind: 'matching',
      objectId: move.objectId,
      filter: {
        conjunction: 'and',
        conditions: [{ attributeId: move.attributeId, operator: 'is_any_of', values: [move.from] }],
      },
      except: [],
      asOf: new Date().toISOString(),
    },
    edit: { attributeId: move.attributeId, op: 'set', value: move.to },
  });
  if (job.status === 'ready') {
    await data.jobs.confirm(slug, job.id);
    return;
  }
  // Still counting: confirm when it is ready, and stop following once it is past that.
  await new Promise<void>((resolve) => {
    let isDone = false;
    const stop = data.jobs.follow(() => {
      const now = data.jobs.get(slug, job.id);
      if (isDone || now === undefined) return;
      if (now.status === 'ready') {
        isDone = true;
        stop();
        void data.jobs.confirm(slug, job.id).then(() => {
          resolve();
        });
      } else if (PAST_READY.has(now.status)) {
        isDone = true;
        stop();
        resolve();
      }
    });
  });
}
