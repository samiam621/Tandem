// This module fetches available OpenRouter models and filters them to free-only ones.
// isFreeModelId lives in @tandem/shared so the client and server share one definition.
import { isFreeModelId } from '@tandem/shared'

export interface OpenRouterModel {
  id: string
  name: string
}

// Fallback list used in dev when there is no OPENROUTER_API_KEY.
// The default free model lives here so it's easy to swap if the ID changes.
const DEV_FREE_MODELS: OpenRouterModel[] = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)' },
]

// Re-export so routes/services that only need isFreeModelId don't have to
// import both packages — but the authoritative source is @tandem/shared.
export { isFreeModelId }

// Call before every OpenRouter completion
export function assertModelAllowed(modelId: string): void {
  if (!isFreeModelId(modelId)) {
    throw new Error(`Paid model "${modelId}" is blocked. Pick a :free model.`)
  }
}

// Fetches the list of all OpenRouter models and keeps only the free ones.
// Falls back to DEV_FREE_MODELS when no API key is configured (local dev).
export async function fetchFreeModels(): Promise<OpenRouterModel[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return DEV_FREE_MODELS

  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) {
    throw new Error(`OpenRouter model list request failed with status ${response.status}`)
  }

  const data = (await response.json()) as { data: OpenRouterModel[] }
  // Keep only models whose ID ends with :free, and append "(Free)" to each name
  // so the UI can make it obvious to users that these are zero-cost models.
  return data.data
    .filter((model) => isFreeModelId(model.id))
    .map((model) => ({ id: model.id, name: `${model.name} (Free)` }))
}
