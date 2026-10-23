// Whether a person's account picture shows on their public pages (owner ask A124, 23 Oct 2026): their booking pages
// and their `/<handle>` profile show initials while they keep it off. The person's own choice, the same in every
// workspace, kept in schema auth (`auth.user_prefs`, migration 0091) and reached only through crm_handle's two
// definer functions, inside the caller's workspace transaction. The profile's own reader, `crm_handle_owner`,
// already answers no picture for a person who keeps it off.
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';

interface HiddenRow extends Record<string, unknown> {
  readonly user_id: string;
}

/** Whether the person keeps their account picture off their public pages (`crm_pictures_hidden`). */
export async function isPictureHidden(tx: WorkspaceTx, userId: string): Promise<boolean> {
  const found = await tx.execute<HiddenRow>(
    sql`select user_id::text as user_id from crm_pictures_hidden(array[${userId}::uuid])`,
  );
  return found.rows.length > 0;
}

/** Keeps the person's account picture off their public pages, or shows it again (`crm_save_picture_hidden`). */
export async function savePictureHidden(tx: WorkspaceTx, userId: string, hidden: boolean): Promise<void> {
  await tx.execute(sql`select crm_save_picture_hidden(${userId}::uuid, ${hidden})`);
}
