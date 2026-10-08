// Error of a domain API command carrying its HTTP status. The message is an English literal declared in
// lib/apiErrors.ts (translated by the browser), with the `Head: detail` shape for a variable part. `details` go
// into the JSON answer next to `error` (e.g. `updated`: rows already written when a batched write stopped).
export class ApiError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 501 | 502, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
