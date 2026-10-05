// Thin client wrapper around the REST API.
// All requests go through here so we can centralize the server URL and token.

declare global {
  interface Window {
    tandem: {
      onProtocolUrl: (cb: (url: string) => void) => () => void
      getToken: () => Promise<string | null>
      setToken: (token: string) => Promise<void>
      clearToken: () => Promise<void>
      getServerUrl: () => Promise<string>
      setServerUrl: (url: string) => Promise<void>
      notify: (title: string, body: string) => Promise<void>
      writeText: (text: string) => Promise<void>
      onMenuAction: (cb: (action: string) => void) => () => void
    }
  }
}

async function getBase(): Promise<string> {
  return window.tandem.getServerUrl()
}

// Content-Type only with a body: the server rejects an empty body labeled as JSON (e.g. a body-less
// POST to /share or DELETE).
async function getHeaders(hasBody: boolean): Promise<HeadersInit> {
  const token = await window.tandem.getToken()
  return {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBase()
  const headers = await getHeaders(init?.body != null)
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body?.error?.message ?? res.statusText), { code: body?.error?.code, status: res.status })
  }
  return res.json()
}

export const api = {
  health: () => request<{ ok: boolean }>('/api/health'),

  auth: {
    guest: (displayName: string, deviceId: string) =>
      request<{ user: import('@tandem/shared').User; token: string }>('/api/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ displayName, deviceId }),
      }),
    exchange: (code: string) =>
      request<{ user: import('@tandem/shared').User; token: string }>('/api/auth/exchange', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    logout: () =>
      request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    me: () =>
      request<import('@tandem/shared').User>('/api/me'),
    githubUrl: async () => {
      const base = await getBase()
      return `${base}/api/auth/github`
    },
  },

  sessions: {
    list: () =>
      request<import('@tandem/shared').Session[]>('/api/sessions'),
    get: (id: string) =>
      request<{ session: import('@tandem/shared').Session; members: import('@tandem/shared').User[] }>(`/api/sessions/${id}`),
    create: (title: string, defaultModel: string) =>
      request<{ session: import('@tandem/shared').Session; mainBranch: import('@tandem/shared').Branch; inviteCode: string }>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title, defaultModel }),
      }),
    join: (inviteCode: string) =>
      request<{ session: import('@tandem/shared').Session; mainBranch: import('@tandem/shared').Branch }>('/api/sessions/join', {
        method: 'POST',
        body: JSON.stringify({ inviteCode }),
      }),
    branches: (id: string) =>
      request<import('@tandem/shared').Branch[]>(`/api/sessions/${id}/branches`),
    agents: (id: string) =>
      request<import('@tandem/shared').SessionAgent[]>(`/api/sessions/${id}/agents`),
    updateBrief: (id: string, content: string, baseUpdatedAt: string | null) =>
      request<import('@tandem/shared').Session>(`/api/sessions/${id}/brief`, {
        method: 'PUT',
        body: JSON.stringify({ content, baseUpdatedAt }),
      }),
    refreshBrief: (id: string) =>
      request<import('@tandem/shared').Session>(`/api/sessions/${id}/brief/refresh`, { method: 'POST' }),
    key: (id: string) =>
      request<import('@tandem/shared').SessionKeyInfo>(`/api/sessions/${id}/key`),
    setKey: (id: string, key: string) =>
      request<import('@tandem/shared').SessionKeyInfo>(`/api/sessions/${id}/key`, {
        method: 'PUT',
        body: JSON.stringify({ key }),
      }),
    removeKey: (id: string) =>
      request<import('@tandem/shared').SessionKeyInfo>(`/api/sessions/${id}/key`, { method: 'DELETE' }),
  },

  documents: {
    list: (sessionId: string) =>
      request<import('@tandem/shared').SessionDocument[]>(`/api/sessions/${sessionId}/documents`),
    get: (documentId: string) =>
      request<import('@tandem/shared').SessionDocument>(`/api/documents/${documentId}`),
    save: (sessionId: string, name: string, content: string, baseUpdatedAt: string | null) =>
      request<import('@tandem/shared').SessionDocument>(`/api/sessions/${sessionId}/documents`, {
        method: 'PUT',
        body: JSON.stringify({ name, content, baseUpdatedAt }),
      }),
    delete: (documentId: string) =>
      request<{ ok: boolean }>(`/api/documents/${documentId}`, { method: 'DELETE' }),
  },

  models: {
    // With a sessionId: the models that session can use (every model once it has its own key)
    list: (sessionId?: string) =>
      request<{ id: string; name: string }[]>(`/api/models${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`),
  },

  messages: {
    list: (branchId: string) =>
      request<import('@tandem/shared').Message[]>(`/api/branches/${branchId}/messages`),
    post: (branchId: string, content: string, triggerAi = true) =>
      request<{ userMessage: import('@tandem/shared').Message; pendingAssistantId?: string }>(`/api/branches/${branchId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, triggerAi }),
      }),
  },

  branches: {
    update: (branchId: string, data: { name?: string; model?: string }) =>
      request<import('@tandem/shared').Branch>(`/api/branches/${branchId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    create: (sessionId: string, fromMessageId: string, model: string, name?: string, documentIds?: string[], purpose?: string) =>
      request<import('@tandem/shared').Branch>(`/api/sessions/${sessionId}/branches`, {
        method: 'POST',
        body: JSON.stringify({ fromMessageId, model, name, documentIds, purpose }),
      }),
    updateContext: (branchId: string, content: string, baseUpdatedAt: string | null) =>
      request<import('@tandem/shared').Branch>(`/api/branches/${branchId}/context`, {
        method: 'PUT',
        body: JSON.stringify({ content, baseUpdatedAt }),
      }),
    regenerateContext: (branchId: string) =>
      request<import('@tandem/shared').Branch>(`/api/branches/${branchId}/context/regenerate`, { method: 'POST' }),
    setDocuments: (branchId: string, documentIds: string[]) =>
      request<import('@tandem/shared').Branch>(`/api/branches/${branchId}/documents`, {
        method: 'PUT',
        body: JSON.stringify({ documentIds }),
      }),
    share: (branchId: string) =>
      request<import('@tandem/shared').Message>(`/api/branches/${branchId}/share`, {
        method: 'POST',
      }),
  },

  tokens: {
    list: () =>
      request<import('@tandem/shared').ApiToken[]>('/api/tokens'),
    create: (label: string) =>
      request<{ token: import('@tandem/shared').ApiToken; rawToken: string }>('/api/tokens', {
        method: 'POST',
        body: JSON.stringify({ label }),
      }),
    revoke: (id: string) =>
      request<{ ok: boolean }>(`/api/tokens/${id}`, { method: 'DELETE' }),
  },
}
