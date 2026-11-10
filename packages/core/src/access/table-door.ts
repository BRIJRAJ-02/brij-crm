// Table seating's public door (spec 0066 B7 lite; spec 0065 AC-6550, AC-6557): a reservation page's key (the
// place's public key) names a place through `crm_table_place_by_key` (ids only, only while the workspace is live), then the guest acts as that place's narrow `booking` actor: write on People and Companies of that
// one workspace (the guest's Person is matched or made) and no permission at all. Whether the page takes reservations
// (`installed`) is the services' question. Exported only from `@crm/core/public`.
export { enterNewsPlace, enterTablePage, TABLE_KEY_PATTERN, type TableEntry } from './door.ts';
