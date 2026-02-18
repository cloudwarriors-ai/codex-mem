export async function requestJson(path, init) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error?.message === "string"
        ? data.error.message
        : `HTTP ${response.status}`;

    throw new Error(message);
  }

  return data;
}
