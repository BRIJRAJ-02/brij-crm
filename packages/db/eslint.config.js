import { server } from '@crm/config/eslint';

// The one package allowed to open database connections.
export default server({ root: import.meta.dirname, databaseDriver: true });
