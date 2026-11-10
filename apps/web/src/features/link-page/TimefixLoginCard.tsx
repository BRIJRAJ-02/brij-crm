// Brief
// Purpose: a connected app's person, on their own page inside the app's frame, learns they can also have their own
// Timefix login (spec 0070, AC-7023), and whom to ask for it.
// Main task: none; it is information. An admin of the workspace sets the login up in Timefix (Team pages).
// Leaves out: any action (coordinator, 10 Nov 2026: a login is never started from inside an app's frame, so the app
// can't mint one), and any card once they have a login.
import type { DataLayer } from '@crm/data';
import { Card } from '@crm/ui';
import { useEffect, useState } from 'react';
import { teamStrings as strings } from './team-strings.ts';

/** Props for the Timefix login card. */
export interface TimefixLoginCardProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The workspace's name, which the line asks them to go to. */
  readonly workspaceName: string | undefined;
}

/**
 * A Card under the person's page with one line: ask an admin of the workspace to set up your login. Read when the
 * page opens; it draws nothing while it reads, when the read fails (it is an extra, never in the way), or for anyone
 * a login can't be set up for (anyone with one already).
 */
export function TimefixLoginCard({ data, slug, workspaceName }: TimefixLoginCardProps) {
  const [canSetUp, setCanSetUp] = useState(false);
  useEffect(() => {
    let isCurrent = true;
    data.teamPages.myLogin(slug).then(
      (read) => {
        if (isCurrent) setCanSetUp(read.canSetUp);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug]);
  if (!canSetUp) return null;
  return <Card title={strings.ownLoginTitle} description={strings.ownLoginText(workspaceName)} />;
}
