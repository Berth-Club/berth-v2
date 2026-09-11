import { SYSTEM_PROMPT } from "./prompt.js"
import { VERDICT_SCHEMA } from "./schema.js"

/**
 * The model call, behind an interface so the pipeline can be exercised without
 * a key and without the network.
 *
 * Same reason the GitHub reader takes an injectable fetch: the behaviour worth
 * testing is what happens around the call, such as a reply that does not parse,
 * a batch that crashes halfway, a verdict citing something it was not given.
 * None of that is reachable if the only way to run the code is to pay for it.
 */

export interface ModelReply {
  raw: string
  usage?: { inputTokens?: number; outputTokens?: number }
  requestId?: string
}

export interface ModelClient {
  readonly modelId: string
  complete(userPrompt: string, signal?: AbortSignal): Promise<ModelReply>
}

/** Pinned per epoch and written to every audit row alongside the prompt hash. */
export const DEFAULT_MODEL_ID = "claude-sonnet-5"

const API = "https://api.anthropic.com/v1/messages"
const MAX_TOKENS = 1024

/**
 * Which provider scores this week.
 *
 * The four defences against a contribution talking its way to a high score
 * live on our side of the call, not the provider's: frozen sources, the closed
 * schema re-checked here, the cited-id check, and giving the model no tools and
 * no way to fetch a URL. So swapping the provider does not weaken them.
 *
 * It does change how hard the obvious attempt is. A smaller model is easier to
 * steer with text inside the contribution, and the schema check catches a
 * malformed reply but not a well-formed reply with a flattered number in it.
 * Whichever provider scores a week is written onto every audit row, so a
 * disputed score can at least be traced to the thing that produced it.
 */
export type Provider = "anthropic" | "deepseek"

export interface AnthropicOptions {
  apiKey: string
  modelId?: string
  fetchImpl?: typeof fetch
}

/**
 * Anthropic's Messages API, asked for one tool call so the reply is structured.
 *
 * No temperature. Claude 5 models reject the parameter, and asking for
 * determinism the API does not offer would be a comforting lie in the audit
 * trail. What makes a score reproducible is the frozen triple of model id,
 * prompt hash and schema hash, all of which are stored.
 */
export function makeAnthropicClient(opts: AnthropicOptions): ModelClient {
  const doFetch = opts.fetchImpl ?? fetch
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID

  return {
    modelId,
    async complete(userPrompt, signal) {
      const res = await doFetch(API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal,
        body: JSON.stringify({
          model: modelId,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          // Forcing the tool is how the reply comes back shaped. The schema is
          // still re-checked on our side, because "the model used the tool" and
          // "the arguments are valid" are different claims.
          tools: [
            {
              name: "record_verdict",
              description: "Record the score and the reason for one contribution.",
              input_schema: VERDICT_SCHEMA,
            },
          ],
          tool_choice: { type: "tool", name: "record_verdict" },
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`Anthropic returned ${res.status}: ${body.slice(0, 200)}`)
      }

      const json = (await res.json()) as {
        content?: Array<{ type: string; input?: unknown; text?: string }>
        usage?: { input_tokens?: number; output_tokens?: number }
        id?: string
      }

      const toolUse = json.content?.find((c) => c.type === "tool_use")
      const raw = toolUse
        ? JSON.stringify(toolUse.input)
        : (json.content?.find((c) => c.type === "text")?.text ?? "")

      return {
        raw,
        usage: {
          inputTokens: json.usage?.input_tokens,
          outputTokens: json.usage?.output_tokens,
        },
        requestId: json.id,
      }
    },
  }
}

/* ─────────────────────────────── deepseek ────────────────────────────────── */

const DEEPSEEK_API = "https://api.deepseek.com/chat/completions"
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat"

export interface DeepseekOptions {
  apiKey: string
  /** `deepseek-chat` for V3, `deepseek-reasoner` for R1. */
  modelId?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

/**
 * DeepSeek, through its OpenAI-compatible chat completions endpoint.
 *
 * Two differences from the Anthropic path, both of which matter.
 *
 * There is no forced tool call, so the schema cannot be enforced by the API.
 * JSON mode guarantees the reply parses as JSON and nothing more: it will not
 * keep a field out or a score inside 0 to 100. So the schema is spelled into
 * the prompt and then re-checked here on the way back, which is the same check
 * the Anthropic path runs anyway. The API is asked for a shape; only our own
 * parser decides whether it got one.
 *
 * Temperature is pinned to 0, which DeepSeek accepts and Claude 5 does not.
 * That buys more run-to-run stability than the Anthropic path can offer. It is
 * still not a guarantee, so the audit row is what actually makes a score
 * checkable, exactly as before.
 */
export function makeDeepseekClient(opts: DeepseekOptions): ModelClient {
  const doFetch = opts.fetchImpl ?? fetch
  const modelId = opts.modelId ?? DEEPSEEK_DEFAULT_MODEL
  const url = opts.baseUrl ?? DEEPSEEK_API

  return {
    modelId,
    async complete(userPrompt, signal) {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
        },
        signal,
        body: JSON.stringify({
          model: modelId,
          max_tokens: MAX_TOKENS,
          temperature: 0,
          // JSON mode refuses the request unless the word appears in the
          // prompt. The system prompt already asks for a JSON object, and
          // `jsonSchemaInstruction` repeats it with the field list.
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `${userPrompt}\n\n${jsonSchemaInstruction()}` },
          ],
        }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`DeepSeek returned ${res.status}: ${body.slice(0, 200)}`)
      }

      const json = (await res.json()) as {
        id?: string
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }

      const choice = json.choices?.[0]
      // A reply cut off at the token limit is usually truncated JSON, which
      // would fail the parser with a confusing message. Say what happened.
      if (choice?.finish_reason === "length") {
        throw new Error(`DeepSeek stopped at the ${MAX_TOKENS} token limit`)
      }

      return {
        raw: choice?.message?.content ?? "",
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
        },
        requestId: json.id,
      }
    },
  }
}

/**
 * The schema, written out for a provider that cannot be handed one.
 *
 * Generated from `VERDICT_SCHEMA` rather than typed out beside it, so the
 * prompt cannot drift from the thing the parser enforces.
 */
export function jsonSchemaInstruction(): string {
  const props = VERDICT_SCHEMA.properties
  return [
    `Reply with exactly one JSON object and no other text. It must have these`,
    `three fields and no others:`,
    `  "score":  ${props.score.description} Integer, ${props.score.minimum} to ${props.score.maximum}.`,
    `  "reason": ${props.reason.description} At most ${props.reason.maxLength} characters.`,
    `  "cited":  ${props.cited.description} Array of strings.`,
    `Any extra field means the reply is discarded and the contribution scores zero.`,
  ].join("\n")
}

/**
 * The client the worker uses, chosen from what is configured.
 *
 * Explicit `HM_SCORER` wins, so a week can be pinned to one provider even when
 * both keys are present. Otherwise whichever key exists is used, and neither
 * means no scoring rather than a crash: a missing secret degrades the handler
 * that needs it and leaves the rest of the worker running.
 */
export function pickClient(cfg: {
  provider?: string
  anthropicApiKey?: string
  deepseekApiKey?: string
  modelId?: string
}): ModelClient | null {
  const wanted = cfg.provider?.toLowerCase()

  if (wanted === "deepseek") {
    if (!cfg.deepseekApiKey) return null
    return makeDeepseekClient({ apiKey: cfg.deepseekApiKey, modelId: cfg.modelId })
  }
  if (wanted === "anthropic") {
    if (!cfg.anthropicApiKey) return null
    return makeAnthropicClient({ apiKey: cfg.anthropicApiKey, modelId: cfg.modelId })
  }
  if (wanted) return null

  if (cfg.anthropicApiKey) {
    return makeAnthropicClient({ apiKey: cfg.anthropicApiKey, modelId: cfg.modelId })
  }
  if (cfg.deepseekApiKey) {
    return makeDeepseekClient({ apiKey: cfg.deepseekApiKey, modelId: cfg.modelId })
  }
  return null
}
