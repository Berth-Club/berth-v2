/**
 * Strip secrets out of anything before it is logged or written to `last_error`.
 *
 * This is not belt-and-braces. The paid RPC endpoint carries its key in the URL
 * path, and viem puts the request URL straight into the message of an
 * `HttpRequestError`. That error reaches two places a person reads: the worker's
 * logs, and `hm_jobs.last_error`, which the operator panel shows on the page. So
 * an ordinary upstream failure would publish the key.
 *
 * Configured URLs are read once at module load, because the point is to catch
 * them wherever they surface, not to require every call site to remember.
 */

const SECRET_ENV_KEYS = [
  "RPC_URL",
  "RPC_URL_PAID",
  "INDEXER_URL",
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "FOMO_API_KEY",
  "KEEPER_PRIVATE_KEY",
] as const

function secrets(): string[] {
  const out: string[] = []
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key]
    // Short values would match too much ordinary text to be worth replacing.
    if (value && value.length >= 8) out.push(value)
  }
  return out
}

/** Anything that looks like a bearer token or a key in a query string. */
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]"],
  [/([?&](?:api[_-]?key|key|token|secret|access[_-]?token)=)[^&\s"']+/gi, "$1[redacted]"],
  [/\b0x[a-fA-F0-9]{64}\b/g, "[redacted-key]"], // a bare private key
]

/** Redact a string. */
export function redactString(input: string): string {
  let out = input
  for (const secret of secrets()) out = out.split(secret).join("[redacted]")
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/**
 * Turn anything thrown into one safe line.
 *
 * Errors are reduced to name and message on purpose. A stack trace adds little
 * for an operator reading a table, and serialising a caught object wholesale is
 * how a wallet client or a config object ends up in the database.
 */
export function redact(error: unknown, maxLength = 500): string {
  let text: string
  if (error instanceof Error) {
    text = `${error.name}: ${error.message}`
    const cause = (error as { cause?: unknown }).cause
    if (cause instanceof Error) text += ` (caused by ${cause.name}: ${cause.message})`
  } else if (typeof error === "string") {
    text = error
  } else {
    try {
      text = JSON.stringify(error)
    } catch {
      text = String(error)
    }
  }

  const safe = redactString(text).replace(/\s+/g, " ").trim()
  return safe.length > maxLength ? `${safe.slice(0, maxLength - 1)}…` : safe
}
