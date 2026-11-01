// A followed record's sentence in the inbox (collaboration): plain words over counts, apart from the list's React
// code so it tests in Node.
import { strings } from './strings.ts';

/** What someone did on a record the reader follows: how many fields changed, notes added, comments, tasks done. */
export interface NotificationActivity {
  readonly fields: number;
  readonly notes: number;
  readonly comments: number;
  readonly tasks: number;
}

/** A followed record's sentence: one kind of change named and counted, or a mix counted as changes. */
export function activitySentence(actor: string, activity: NotificationActivity): string {
  const parts = (['fields', 'notes', 'comments', 'tasks'] as const).filter((key) => activity[key] > 0);
  const [only] = parts;
  if (parts.length === 1 && only !== undefined) return strings.activity[only](actor, activity[only]);
  if (parts.length === 0) return strings.sentence.record_activity(actor);
  const total = activity.fields + activity.notes + activity.comments + activity.tasks;
  return strings.activity.mixed(actor, total);
}
