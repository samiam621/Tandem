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

async function getHeaders(): Promise<HeadersInit> {
  const token = await window.tandem.getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = await getBase()
  const headers = await getHeaders()
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body?.error?.message ?? res.statusText), { code: body?.error?.code, status: res.status })
  }
  return res.json()
}

async function requestNoBody(path: string, init?: RequestInit): Promise<void> {
  const base = await getBase()
  const headers = await getHeaders()
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body?.error?.message ?? res.statusText), { code: body?.error?.code, status: res.status })
  }
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
  },

  models: {
    list: () => request<{ id: string; name: string }[]>('/api/models'),
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
    update: (branchId: string, data: { name?: string; model?: string; pinnedDocIds?: string[] }) =>
      request<import('@tandem/shared').Branch>(`/api/branches/${branchId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    create: (sessionId: string, fromMessageId: string, model: string, name?: string, docIds?: string[]) =>
      request<import('@tandem/shared').Branch>(`/api/sessions/${sessionId}/branches`, {
        method: 'POST',
        body: JSON.stringify({ fromMessageId, model, name, docIds }),
      }),
    share: (branchId: string) =>
      request<import('@tandem/shared').Message>(`/api/branches/${branchId}/share`, {
        method: 'POST',
      }),
  },

  docs: {
    list: (sessionId: string) =>
      request<import('@tandem/shared').ProjectDocMeta[]>(`/api/sessions/${sessionId}/docs`),
    get: (docId: string) =>
      request<import('@tandem/shared').ProjectDoc>(`/api/docs/${docId}`),
    upload: (sessionId: string, body: { title: string; text: string } | { title: string; pdfBase64: string }) =>
      request<import('@tandem/shared').ProjectDocMeta>(`/api/sessions/${sessionId}/docs`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    delete: (docId: string) =>
      requestNoBody(`/api/docs/${docId}`, { method: 'DELETE' }),
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
