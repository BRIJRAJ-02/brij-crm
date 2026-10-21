// Brief
// Purpose: first run's About you (spec 0036): a few taps on what someone does, so their setup starts in the right place.
// Main task: pick a role, a team size and what Timefix is for (any, all or none), then Continue, or Skip.
// Leaves out: free text, company details and anything other members would see; every answer is optional.
import type { OnboardingAnswers, OnboardingArea, OnboardingRole, OnboardingTeamSize } from '@crm/data';
import { Button, ChoiceChips, Form } from '@crm/ui';
import { ALL_AREAS, AREAS, areasFromChips, chipsFromAreas, ROLES, TEAM_SIZES } from './details.ts';
import { strings } from './strings.ts';

/** Props for About you. */
export interface DetailsStepProps {
  readonly answers: OnboardingAnswers;
  readonly onAnswers: (answers: OnboardingAnswers) => void;
  readonly onContinue: () => void;
  /** Goes on with no answers kept. */
  readonly onSkip: () => void;
}

/**
 * About you: three rows of chips (Your role and Team size pick one, what
 * Timefix is for picks any, "All of it" every area), Continue (Enter), and
 * Skip, which forgets the answers.
 */
export function DetailsStep({ answers, onAnswers, onContinue, onSkip }: DetailsStepProps) {
  const areas = answers.areas ?? [];
  return (
    <Form
      submitLabel={strings.continue}
      onSubmit={onContinue}
      actions={
        <Button variant="ghost" size="lg" isFullWidth="center" onPress={onSkip}>
          {strings.skip}
        </Button>
      }
    >
      <ChoiceChips
        label={strings.role}
        isSingle
        choices={ROLES.map((role) => ({ id: role, label: strings.roles[role] }))}
        selected={answers.role === undefined ? [] : [answers.role]}
        onChange={(picked) => {
          const role = ROLES.find((each) => each === picked[0]);
          const { role: _dropped, ...rest } = answers;
          onAnswers(role === undefined ? rest : { ...rest, role: role satisfies OnboardingRole });
        }}
      />
      <ChoiceChips
        label={strings.teamSize}
        isSingle
        choices={TEAM_SIZES.map((size) => ({ id: size, label: strings.teamSizes[size] }))}
        selected={answers.teamSize === undefined ? [] : [answers.teamSize]}
        onChange={(picked) => {
          const teamSize = TEAM_SIZES.find((each) => each === picked[0]);
          const { teamSize: _dropped, ...rest } = answers;
          onAnswers(teamSize === undefined ? rest : { ...rest, teamSize: teamSize satisfies OnboardingTeamSize });
        }}
      />
      <ChoiceChips
        label={strings.areas}
        choices={[...AREAS, ALL_AREAS].map((area: OnboardingArea | typeof ALL_AREAS) => ({
          id: area,
          label: strings.areaNames[area],
        }))}
        selected={chipsFromAreas(areas)}
        onChange={(chips) => {
          onAnswers({ ...answers, areas: areasFromChips(areas, chips) });
        }}
      />
    </Form>
  );
}
