// ---------------------------------------------------------------------------
// Provider catalog client — fetches connected providers from the server
// ---------------------------------------------------------------------------

export interface DiscoveredProvider {
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
 * Fetch the list of connected providers from the Sixerr server.
 * Best-effort: returns empty array on network/parse errors.
 */
export async function fetchProviderCatalog(
  serverHttpUrl: string,
): Promise<DiscoveredProvider[]> {
  try {
    const url = `${serverHttpUrl.replace(/\/$/, "")}/v1/providers`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as { providers?: DiscoveredProvider[] };
    return data.providers ?? [];
  } catch {
    return [];
  }
}

/**
 * Build OpenClaw model entries from discovered providers.
 * Always includes "auto" as the first entry.
 */
export function buildModelList(providers: DiscoveredProvider[]): ModelEntry[] {
  const models: ModelEntry[] = [
    { id: "auto", name: "Auto (cheapest available)" },
  ];

  for (const provider of providers) {
    models.push({
      id: provider.agentId,
      name: provider.agentId,
    });
  }

  return models;
}
