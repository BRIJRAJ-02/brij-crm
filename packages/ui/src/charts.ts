// `@crm/ui/charts`: the report chart, a heavy entry of its own (spec 0003), so the Reports page loads it lazily
// and it never sits in the first load.
export { Chart, type ChartKind, type ChartPoint, type ChartProps } from './modules/Chart/Chart.tsx';
