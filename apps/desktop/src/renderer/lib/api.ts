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

export const api = {
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
    update: (branchId: string, data: { name?: string; model?: string }) =>
      request<import('@tandem/shared').Branch>(`/api/branches/${branchId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    create: (sessionId: string, fromMessageId: string, model: string, name?: string) =>
      request<import('@tandem/shared').Branch>(`/api/sessions/${sessionId}/branches`, {
        method: 'POST',
        body: JSON.stringify({ fromMessageId, model, name }),
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
