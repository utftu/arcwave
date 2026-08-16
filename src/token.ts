// export class TokenError extends Error {
//   readonly code: string;
//   readonly description?: string;
//   readonly uri?: string;

//   constructor(code: string, description?: string, uri?: string) {
//     super(description ?? code);
//     this.name = "TokenError";
//     this.code = code;
//     this.description = description;
//     this.uri = uri;
//   }
// }

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

// Some providers (GitHub) return `{ error, error_description }` with a 200 status
// instead of following RFC 6749 §5.2's 400, so `error` in the body is the source
// of truth — not response.ok.
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
