/**
 * Secret query parameters masked (`api_key=…` → `api_key=***`): an error message may carry the URL it called, key
 * included (requests' HTTPError, 2026-11-09). Used for the job logs (runner) and their display (DirlaData console).
 */
export const redactSecrets = (line: string): string =>
  line.replace(/((?:[?&;]|%3F|%26)(?:api_key|apikey|api-key|access_token|token|key)(?:=|%3D))(?:(?!%26)[^&\s'"<>])+/gi, '$1***');
