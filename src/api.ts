import type { DrawingIn, DrawingOut, IndexRow, Lease, PackRow } from '../shared/types';

export const API_BASE: string = import.meta.env?.VITE_API ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly body: Record<string, unknown>) {
    super(message);
  }
}

export type Hello = { lat: number | null; lon: number | null; count: number };
export type IndexOut = { rows: IndexRow[]; hidden: number[]; count: number };
export type PackOut = { v: number; rows: PackRow[] };

export function createApi(base = API_BASE, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    // POST bodies go as text/plain: a simple request, so no CORS preflight to pay for.
    const res = await fetchImpl(base + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, out.error ?? res.statusText, out);
    return out as T;
  }
  return {
    hello: () => call<Hello>('/hello'),
    index: (since: number) => call<IndexOut>(`/index?since=${since}`),
    pack: (z: number, px: number, py: number, v: number) => call<PackOut>(`/pack/${z}/${px}/${py}?v=${v}`),
    drawing: (id: number) => call<DrawingOut>(`/d/${id}`),
    lease: (key?: string) => call<Lease>('/lease', key ? { key } : {}),
    draw: (d: DrawingIn) => call<{ id: number }>('/draw', d),
    flag: (id: number) => call<{ hidden: boolean }>('/flag', { id }),
  };
}

export type Api = ReturnType<typeof createApi>;
