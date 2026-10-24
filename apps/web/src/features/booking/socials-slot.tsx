// The page editor's Social links card, where it stands (booking socials, 25 Oct 2026): the card's own module
// (SocialsCard.tsx, with the editor it opens) and the person's links store load on their own, out of the editor's
// first paint and out of the app's first load. Until the card arrives its loading shape stands where it will.
// Main task: hold the card's place until the card arrives.
// Leaves out: the card itself (SocialsCard.tsx).
import { Card, SettingsRow, Skeleton } from '@crm/ui';
import { lazy, Suspense, type ComponentProps } from 'react';
import { strings } from './socials-strings.ts';

const LazySocialsCard = lazy(() => import('./SocialsCard.tsx').then((module) => ({ default: module.SocialsCard })));

type SocialsCardProps = ComponentProps<typeof LazySocialsCard>;

/** The card while its module loads, in the shape it will take for this page: a team page's, a colleague's, or the owner's. */
export function SocialsCardPending({ isTeam, isOwner }: Pick<SocialsCardProps, 'isTeam' | 'isOwner'>) {
  if (isTeam) return <Card title={strings.title} description={strings.team} />;
  if (!isOwner) {
    return (
      <Card title={strings.title} isBusy>
        <SettingsRow title={strings.shown} description={strings.notOwner} />
      </Card>
    );
  }
  return (
    <Card title={strings.title} description={strings.everywhere} isBusy>
      <SettingsRow title={strings.shown} description={<Skeleton width="short" />} />
    </Card>
  );
}

/** The card, loaded on its own; its loading shape until then. */
export function SocialsCardSlot(props: SocialsCardProps) {
  return (
    <Suspense fallback={<SocialsCardPending isTeam={props.isTeam} isOwner={props.isOwner} />}>
      <LazySocialsCard {...props} />
    </Suspense>
  );
}
