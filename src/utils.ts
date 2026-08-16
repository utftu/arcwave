export function buildUrl(
  endpoint: string,
  params: Record<string, string | undefined>,
): URL {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}
