export async function getToken<T>(
  endpoint: string,
  body: Record<string, string | undefined>,
  headers?: Record<string, string>,
): Promise<T> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      form.set(key, value);
    }
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Accept: "application/json", ...headers },
    body: form,
  });

  const data: unknown = await response.json();

  if (checkError(data)) {
    throw new Error(data.error);
  }

  return data as T;
}

function checkError(
  data: unknown,
): data is { error: string; error_description?: string; error_uri?: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
  );
}
