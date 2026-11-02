// Spec 0063's batch two of answer types, Signature and Ranking, as one lazy chunk (AC-6331). Two chunks would each
// be smaller, but the second dynamic entry split the app's shared chunks differently and cost the app's first load
// about 0.7 kB (measured 31 October 2026), which it does not have. A form that asks neither loads neither.
export { RankingQuestion } from './RankingQuestion.tsx';
export { SignatureQuestion } from './SignatureQuestion.tsx';
