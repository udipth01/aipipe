export function updateHeaders(headers, skip, update) {
  const result = new Headers();
  for (const [key, value] of headers) if (!skip.some((pattern) => pattern.test(key))) result.append(key, value);
  for (const [key, value] of Object.entries(update ?? {})) result.set(key, value);
  return result;
}

export function addCors(headers) {
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return headers;
}
