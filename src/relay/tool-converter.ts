// ---------------------------------------------------------------------------
// ClientToolDefinition (matches OpenClaw's ClientToolDefinition shape)
// ---------------------------------------------------------------------------

/**
 * Simplified tool definition for client-provided tools.
 * Matches OpenClaw's ClientToolDefinition from pi-embedded-runner/run/params.ts.
 */
export interface ClientToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// convertToolsToClientTools (RELAY-03 defense-in-depth)
// ---------------------------------------------------------------------------

/**
 * Actively convert an array of tool definitions to sanitized ClientToolDefinition[].
 *
 * Defense-in-depth measure: even though OpenClaw's /v1/responses endpoint
 * internally treats all request tools as ClientToolDefinition[] via
 * extractClientTools(), the plugin MUST actively sanitize tools before forwarding.
 *
 * For each tool:
 * 1. Validates type: "function" and function.name is a non-empty string
 * 2. Extracts ONLY allowed fields (function.name, function.description, function.parameters)
 * 3. Constructs a fresh ClientToolDefinition (no reference passthrough)
 * 4. Skips invalid tools with a warning log
 */
export function convertToolsToClientTools(tools: unknown[]): ClientToolDefinition[] {
  const result: ClientToolDefinition[] = [];

  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];

    // Must be a plain object
    if (!isPlainObject(tool)) {
      console.warn(`[tool-converter] Skipping invalid tool at index ${i}: not an object`);
      continue;
    }

    // Must have type: "function"
    if (tool.type !== "function") {
      console.warn(`[tool-converter] Skipping invalid tool at index ${i}: missing type or function.name`);
      continue;
    }

    // Must have a function property that is a plain object
    if (!isPlainObject(tool.function)) {
      console.warn(`[tool-converter] Skipping invalid tool at index ${i}: missing type or function.name`);
      continue;
    }

    const fn = tool.function;

    // Must have a non-empty name string
    if (typeof fn.name !== "string" || fn.name.length === 0) {
      console.warn(`[tool-converter] Skipping invalid tool at index ${i}: missing type or function.name`);
      continue;
    }

    // Construct a fresh ClientToolDefinition with only allowed fields
    const sanitized: ClientToolDefinition = {
      type: "function",
      function: {
        name: fn.name,
      },
    };

    // Optional: description (only if string)
    if (typeof fn.description === "string") {
      sanitized.function.description = fn.description;
    }

    // Optional: parameters (only if plain object)
    if (isPlainObject(fn.parameters)) {
      sanitized.function.parameters = fn.parameters as Record<string, unknown>;
    }

    result.push(sanitized);
  }

  return result;
}
