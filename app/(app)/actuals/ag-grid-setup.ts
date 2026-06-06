/**
 * AG Grid module registration — imported once at module scope by actuals-grid.tsx.
 *
 * A2 finding (03-01 spike): AllCommunityModule is sufficient. No Enterprise key,
 * no license toast. Register here so the import side-effect runs exactly once
 * in the client bundle regardless of how many grid instances exist.
 *
 * Do NOT import this file from any Server Component or Route Handler.
 */

import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);
