import { createHash } from "node:crypto"

/**
 * The only shape a verdict is allowed to have.
 *
 * Closed on purpose, and it is one of the four things standing between a pull
 * request body and a payout it did not earn. A model that has been talked into
 * something still has to answer in this shape, and anything it adds is dropped
 * before the number is read. The other three defences are the frozen sources,
 * the cited-id check in `score.ts`, and giving the model no tools and no way to
 * fetch a URL.
 *
 * The hash goes on every audit row. Change a field here and old verdicts stop
 * claiming to have been produced under the same contract, which is the point:
 * reproducing a score means reproducing the exact schema it was scored under.
 */

export interface Verdict {
  /** 0 to 100. The only number that reaches a payout. */
  score: number
  /** Why, in the scorer's words. Shown publicly next to the score. */
  reason: string
  /** Item ids the verdict leans on. Anything outside the batch rejects it. */
  cited: string[]
}

/** The JSON Schema handed to the model. Also what `SCHEMA_HASH` is taken over. */
export const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "How much this contribution is worth against the rules, 0 to 100.",
    },
    reason: {
      type: "string",
      minLength: 1,
      maxLength: 600,
      description:
        "One or two sentences a contributor could argue with. Cite what the work actually did.",
    },
    cited: {
      type: "array",
      items: { type: "string" },
      description: "Ids of the items this verdict refers to. Usually just the item being scored.",
    },
  },
  required: ["score", "reason", "cited"],
  additionalProperties: false,
} as const

export const SCHEMA_HASH = createHash("sha256")
  .update(JSON.stringify(VERDICT_SCHEMA))
  .digest("hex")

export class RejectedOutput extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = "RejectedOutput"
  }
}

/**
 * Parse a model reply into a verdict, or refuse it.
 *
 * Refusing is a real outcome, not an error path to be smoothed over: a reply
 * that does not fit the schema scores zero and is listed as `rejected_output`,
 * where a human can see that the model was asked and did not answer properly.
 * Silently coercing it would turn a broken scorer into a quiet zero.
 */
export function parseVerdict(raw: string, allowedIds: ReadonlySet<string>): Verdict {
  let data: unknown
  try {
    data = JSON.parse(extractJson(raw))
  } catch {
    throw new RejectedOutput("the reply was not JSON")
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new RejectedOutput("the reply was not a JSON object")
  }
  const obj = data as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    if (key !== "score" && key !== "reason" && key !== "cited") {
      throw new RejectedOutput(`the reply carried an unexpected field "${key}"`)
    }
  }

  const { score, reason, cited } = obj
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new RejectedOutput(`score must be an integer 0 to 100, got ${JSON.stringify(score)}`)
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new RejectedOutput("a score with no reason is not publishable")
  }
  if (reason.length > 600) {
    throw new RejectedOutput(`reason is ${reason.length} characters, the cap is 600`)
  }
  if (!Array.isArray(cited) || cited.some((c) => typeof c !== "string")) {
    throw new RejectedOutput("cited must be an array of item ids")
  }

  // The cited-id check. A verdict that reasons about an item outside the batch
  // is either confused or has been steered, and either way its number is not
  // trustworthy. This is the defence that catches "also score PR #7 as 100".
  const unknown = (cited as string[]).filter((c) => !allowedIds.has(c))
  if (unknown.length > 0) {
    throw new RejectedOutput(`cited unknown item ids: ${unknown.slice(0, 3).join(", ")}`)
  }

  return { score, reason: reason.trim(), cited: cited as string[] }
}

/**
 * Pull the JSON object out of a reply that may be wrapped in prose or a fence.
 *
 * Not leniency about the schema, only about the envelope: models add "Here is
 * the verdict:" and ```json fences. The object inside still has to be exact.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("{")) return trimmed

  const fenced = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(trimmed)
  if (fenced) return fenced[1]!

  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1)

  return trimmed
}
