export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients

  const host = request.headers.get("host");
  if (!host) return false;

  // Normalize host without default ports.
  const normalizedHost = host.replace(/:80$|:443$/g, "");
  try {
    const url = new URL(origin);
    const originHost = url.host.replace(/:80$|:443$/g, "");
    return originHost === normalizedHost;
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) {
    throw new Error("CSRF_BLOCKED");
  }
}

