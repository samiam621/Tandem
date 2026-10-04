export interface OpenRouterModel {
  id: string
  name: string
}

const DEV_FREE_MODELS: OpenRouterModel[] = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)' },
]

export function isFreeModelId(modelId: string): boolean {
  return modelId.endsWith(':free')
}

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
  return data.data
    .filter((model) => isFreeModelId(model.id))
    .map((model) => ({ id: model.id, name: `${model.name} (Free)` }))
}
