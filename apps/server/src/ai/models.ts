// Model list — fetched from OpenRouter and cached for 1 hour.
// Free-only unless OPENROUTER_ALLOW_PAID=true, so dev testing can't spend credit.

export type ModelInfo = { id: string; name: string }

const CACHE_TTL = 60 * 60 * 1000
let modelsCache: ModelInfo[] | null = null
let modelsCacheAt = 0

const DEV_MODELS: ModelInfo[] = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (free)' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3 (free)' },
]

export function paidModelsAllowed(): boolean {
  return process.env.OPENROUTER_ALLOW_PAID === 'true'
}

// OpenRouter marks zero-cost model variants with a ":free" suffix
export function isModelAllowed(modelId: string): boolean {
  return paidModelsAllowed() || modelId.endsWith(':free')
}

// Call before every OpenRouter completion
export function assertModelAllowed(modelId: string): void {
  if (!isModelAllowed(modelId)) {
    throw new Error(`Paid model "${modelId}" is blocked. Pick a :free model or set OPENROUTER_ALLOW_PAID=true.`)
  }
}

async function fetchModels(): Promise<ModelInfo[]> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return DEV_MODELS
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`OpenRouter models request failed: ${res.status}`)
  const data = (await res.json()) as { data: ModelInfo[] }
  return data.data
    .filter((m) => isModelAllowed(m.id))
    .map((m) => ({ id: m.id, name: m.name }))
}

// Throws only when there is no cached list to fall back on
export async function listModels(): Promise<ModelInfo[]> {
  if (!modelsCache || Date.now() - modelsCacheAt > CACHE_TTL) {
    try {
      modelsCache = await fetchModels()
      modelsCacheAt = Date.now()
    } catch (err) {
      if (!modelsCache) throw err
    }
  }
  return modelsCache
}
