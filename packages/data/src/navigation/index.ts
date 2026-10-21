// `@crm/data/navigation` (spec 0034): the sidebar's pure model for screens (what each section holds, in the
// member's order), the same rule the server and the data layer apply, kept apart from the layer's entry so it
// never joins the first load. Its types come through `@crm/data`.
export { navKey, sectionItems, sectionOrder } from '@crm/contracts/navigation';
