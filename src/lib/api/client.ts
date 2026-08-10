type RequestInitJson = Omit<RequestInit, "body"> & {
  body?: Record<string, unknown> | unknown[];
};

const DEFAULT_TIMEOUT_MS = 30_000;

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json" };
}

function getTimeoutSignal(options?: { signal?: AbortSignal | null }): AbortSignal {
  if (options?.signal) return options.signal;
  return AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
}

export const api = {
  async get(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, {
      ...options,
      method: "GET",
      headers: { ...options?.headers },
      signal: getTimeoutSignal(options),
    });
  },

  async post(
    url: string,
    body?: Record<string, unknown> | unknown[],
    options?: RequestInitJson
  ): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { ...jsonHeaders(), ...options?.headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: getTimeoutSignal(options),
    });
  },

  async put(
    url: string,
    body?: Record<string, unknown> | unknown[],
    options?: RequestInitJson
  ): Promise<Response> {
    return fetch(url, {
      method: "PUT",
      headers: { ...jsonHeaders(), ...options?.headers },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: getTimeoutSignal(options),
    });
  },

  async delete(url: string, options?: RequestInit): Promise<Response> {
    return fetch(url, {
      ...options,
      method: "DELETE",
      headers: { ...options?.headers },
      signal: getTimeoutSignal(options),
    });
  },

  async json<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await this.get(url, options);
    if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`);
    return res.json();
  },
};
