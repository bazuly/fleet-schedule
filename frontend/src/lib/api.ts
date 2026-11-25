export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080").replace(/\/$/, "");

export type Panel = "main" | "unassigned" | "pickups";

export interface User {
  id: string;
  login: string;
  name: string;
  is_admin: boolean;
}

export interface Row {
  id: string;
  panel: Panel;
  position: number;
  driver: string;
  tractor: string;
  trailer: string;
  note: string;
}

export type RowField = "driver" | "tractor" | "trailer" | "note";

export interface Cell {
  row_id: string;
  day: string;
  value: string;
  bg: string | null;
}

export type RowPatch = { id: string } & Partial<Pick<Row, RowField | "position">>;

export type ServerEvent =
  | { type: "cells"; by: string; client: string | null; cells: Cell[] }
  | { type: "rows"; by: string; client: string | null; rows: Row[] }
  | { type: "row_deleted"; by: string; client: string | null; id: string }
  | { type: "resync" };

/** Уникален для вкладки: по нему отбрасываем эхо собственных изменений из WebSocket. */
export const CLIENT_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const TOKEN_KEY = "fleet.token";

export const tokenStore = {
  get: () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-client-id": CLIENT_ID };
  const token = tokenStore.get();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {}
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
      tokenStore.clear();
      window.location.href = "/login";
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (login: string, password: string) =>
    request<{ token: string; user: User }>("POST", "/auth/login", { login, password }),
  logout: () => request("POST", "/auth/logout"),
  me: () => request<User>("GET", "/auth/me"),
  changePassword: (old_password: string, new_password: string) =>
    request("POST", "/auth/password", { old_password, new_password }),

  users: () => request<User[]>("GET", "/users"),
  createUser: (u: { login: string; name: string; password: string; is_admin: boolean }) =>
    request<User>("POST", "/users", u),
  updateUser: (id: string, u: { name?: string; password?: string; is_admin?: boolean }) =>
    request<User>("PATCH", `/users/${id}`, u),
  deleteUser: (id: string) => request("DELETE", `/users/${id}`),

  rows: () => request<Row[]>("GET", "/rows"),
  createRow: (r: { panel: Panel; position?: number }) => request<Row>("POST", "/rows", r),
  patchRows: (patches: RowPatch[]) => request<Row[]>("PATCH", "/rows", patches),
  deleteRow: (id: string) => request("DELETE", `/rows/${id}`),

  cells: (from: string, to: string) =>
    request<Cell[]>("GET", `/cells?from=${from}&to=${to}`),
  putCells: (cells: Cell[]) => request("PUT", "/cells", { cells }),
};

export function wsUrl(): string {
  return `${API_URL.replace(/^http/, "ws")}/api/ws?token=${encodeURIComponent(tokenStore.get() ?? "")}`;
}
