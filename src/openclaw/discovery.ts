// ---------------------------------------------------------------------------
// Supplier catalog client — fetches connected suppliers from the server
// ---------------------------------------------------------------------------

export interface DiscoveredSupplier {
  agentId: string;
  available: boolean;
  pricing: {
    inputTokenPrice: string;
    outputTokenPrice: string;
  };
}

export interface ModelEntry {
  id: string;
  name: string;
}

/**
 * Fetch the list of connected suppliers from the Sixerr server.
 * Best-effort: returns empty array on network/parse errors.
 */
export async function fetchSupplierCatalog(
  serverHttpUrl: string,
): Promise<DiscoveredSupplier[]> {
  try {
    const url = `${serverHttpUrl.replace(/\/$/, "")}/v1/suppliers`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as { suppliers?: DiscoveredSupplier[] };
    return data.suppliers ?? [];
  } catch {
    return [];
  }
}

/**
 * Build OpenClaw model entries from discovered suppliers.
 * Always includes "auto" as the first entry.
 */
export function buildModelList(suppliers: DiscoveredSupplier[]): ModelEntry[] {
  const models: ModelEntry[] = [
    { id: "auto", name: "Auto (cheapest available)" },
  ];

  for (const supplier of suppliers) {
    models.push({
      id: supplier.agentId,
      name: supplier.agentId,
    });
  }

  return models;
}
