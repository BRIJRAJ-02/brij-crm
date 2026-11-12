import { useState } from 'react';
import type { FormQuestion } from '../HostedForm/answers.ts';
import { QuestionBuilder } from './QuestionList.tsx';

const START: ReadonlyArray<FormQuestion> = [
  { id: 'name', kind: 'short', title: 'What should we call you?', required: true },
  { id: 'email', kind: 'email', title: 'Your work email', required: true, description: 'We send the proposal here.' },
  { id: 'team', kind: 'choice', title: 'How big is your team?', required: true, options: ['Just me', '2 to 10', '11 to 50', 'More than 50'] },
  { id: 'rank', kind: 'ranking', title: 'Rank what matters most', options: ['Price', 'Support', 'Integrations', 'Ease of use'] },
  { id: 'call', kind: 'booking', title: 'Book a Discovery call (30 min)' },
];

export function QuestionListDemo() {
  const [questions, setQuestions] = useState(START);
  return (
    <div className="tf-demo tf-demo--canvas">
      <QuestionBuilder questions={questions} onChange={setQuestions} />
    </div>
  );
}
