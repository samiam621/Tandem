// Model list — fetched from OpenRouter and cached for 1 hour.
// On the server's key: free-only unless OPENROUTER_ALLOW_PAID=true, so dev testing can't spend credit.
// A session with its own key (BYOK) pays for itself, so every model is allowed there.
import { isFreeModelId } from '@tandem/shared'
import { hasSessionKey } from './keys.js'
import { fail } from '../services/errors.js'

export type ModelInfo = { id: string; name: string }

const CACHE_TTL = 60 * 60 * 1000
let modelsCache: ModelInfo[] | null = null // every model; filtered per caller
let modelsCacheAt = 0

// Stands in for the list offline in local dev. The default free model lives here so it's easy to
// swap if the ID changes.
const DEV_MODELS: ModelInfo[] = [
  { id: 'qwen/qwen3.8-27b:free', name: 'Qwen3.8 27B (free)' },
]

export function paidModelsAllowed(): boolean {
  return process.env.OPENROUTER_ALLOW_PAID === 'true'
}

// OpenRouter marks zero-cost model variants with a ":free" suffix
export function isModelAllowed(modelId: string, byok = false): boolean {
  return byok || paidModelsAllowed() || isFreeModelId(modelId)
}

const BLOCKED = 'Pick a :free model, add an OpenRouter key to the session, or set OPENROUTER_ALLOW_PAID=true.'

// Call before every OpenRouter completion
export function assertModelAllowed(modelId: string, byok = false): void {
  if (!isModelAllowed(modelId, byok)) throw new Error(`Paid model "${modelId}" is blocked. ${BLOCKED}`)
}

// Call when a session or branch is given a model, so a paid one is rejected with a 400 up front.
export function assertModelForSession(sessionId: string | null, modelId: string): void {
  if (!isModelAllowed(modelId, sessionId !== null && hasSessionKey(sessionId))) {
    fail(400, 'invalid_request', `"${modelId}" is a paid model. ${BLOCKED}`)
  }
}

// The model list is public; no key is needed to read it. Offline without a server key (local dev),
// a short built-in list stands in.
async function fetchModels(): Promise<ModelInfo[]> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) throw new Error(`OpenRouter models request failed: ${res.status}`)
    const data = (await res.json()) as { data: ModelInfo[] }
    return data.data.map((m) => ({ id: m.id, name: m.name }))
  } catch (err) {
    if (!process.env.OPENROUTER_API_KEY) return DEV_MODELS
    throw err
  }
}

// Throws only when there is no cached list to fall back on. `byok`: the caller's session has its own key.
export async function listModels(byok = false): Promise<ModelInfo[]> {
  if (!modelsCache || Date.now() - modelsCacheAt > CACHE_TTL) {
    try {
      modelsCache = await fetchModels()
      modelsCacheAt = Date.now()
    } catch (err) {
      if (!modelsCache) throw err
    }
  }
  return modelsCache.filter((m) => isModelAllowed(m.id, byok))
}
