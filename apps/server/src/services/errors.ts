// Services signal an expected failure by throwing an Error carrying an HTTP status and an error
// code. REST routes turn it into `{ error: { code, message } }` (routes/errors.ts); MCP tools
// report the message.

export function fail(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), { code, status })
}
