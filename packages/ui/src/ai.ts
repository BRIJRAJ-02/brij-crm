// `@crm/ui/ai`: Ask AI (spec 0073, batch 3, AC-7314), an entry of its own like the grid and the charts, so the screen
// that offers it loads it lazily and it never sits in a first load. The main entry never reaches it (`ai.test.ts`).
export { AIAssist, type AIAnswer, type AIAssistProps } from './modules/AIAssist/AIAssist.tsx';
