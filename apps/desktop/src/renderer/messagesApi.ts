import { api } from './api'
import type { Message } from '@tandem/shared'

// Extend API client with messages and tree endpoints
export const messagesApi = {
  list: (branchId: string) =>
    api.sessions.branches('').then(() => {}) // placeholder — call directly
}

// We'll call api directly in the Session component.
// This file just re-exports for convenience.
export { api }
