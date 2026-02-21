// SOURCE OF TRUTH: sixerr-server/src/schemas/index.ts

/** Schema version for copy-drift detection between server and plugin. */
export const SCHEMA_VERSION = 1 as const;

export * from "./openresponses.js";
export * from "./protocol.js";
export * from "./errors.js";
