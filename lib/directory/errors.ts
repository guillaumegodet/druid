// Error of a domain API command carrying its HTTP status. The message is an English literal declared in
// lib/apiErrors.ts (translated by the browser), with the `Head: detail` shape for a variable part.
export class ApiError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 502, message: string) {
    super(message);
  }
}
