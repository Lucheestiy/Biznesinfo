"use client";

function getStorage(kind: "local" | "session"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeLocalStorageGet(key: string): string | null {
  try {
    return getStorage("local")?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeLocalStorageSet(key: string, value: string): void {
  try {
    getStorage("local")?.setItem(key, value);
  } catch {
    // ignore storage failures in restricted browser contexts
  }
}

export function safeLocalStorageRemove(key: string): void {
  try {
    getStorage("local")?.removeItem(key);
  } catch {
    // ignore storage failures in restricted browser contexts
  }
}

export function safeSessionStorageGet(key: string): string | null {
  try {
    return getStorage("session")?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSessionStorageSet(key: string, value: string): void {
  try {
    getStorage("session")?.setItem(key, value);
  } catch {
    // ignore storage failures in restricted browser contexts
  }
}
