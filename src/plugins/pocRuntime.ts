import { bundledPluginCatalog } from './bundledCatalog';
import { createDeclarativePluginRuntime } from './declarativeRuntime';
// Core is distributed without bundled demonstration plugins.
export const pocPluginRuntime = createDeclarativePluginRuntime(bundledPluginCatalog, [], {});
