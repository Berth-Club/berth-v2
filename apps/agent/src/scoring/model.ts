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

/* ──────────────────── openai-compatible chat completions ─────────────────── */

/**
 * DeepSeek and OpenRouter both speak OpenAI's chat completions format, so they
 * are one client with different defaults rather than two that drift apart.
 *
 * Three things differ from the Anthropic path, and all three matter.
 *
 * There is no forced tool call, so the API cannot enforce the output shape.
 * JSON mode guarantees the reply parses as JSON and nothing more: it will not
 * keep an extra field out or hold a score inside 0 to 100. So the schema is
 * spelled into the prompt and re-checked here on the way back, which is the
 * same check the Anthropic path runs anyway. The API is asked for a shape; only
 * our own parser decides whether it got one.
 *
 * Temperature is pinned to 0, which these accept and Claude 5 rejects. That
 * buys more run-to-run stability than the Anthropic path can offer. It is still
 * not a guarantee, so the audit row remains what makes a score checkable.
 *
 * An error can arrive inside a 200 response. OpenRouter answers that way when
 * an upstream provider fails, and the body has no `choices`. Read naively that
 * becomes an empty reply, which the parser reports as a malformed verdict and
 * scores zero. It is a transport failure and has to be thrown, so the job
 * retries instead of recording a zero someone has to dispute.
 */

const MAX_TOKENS_JSON = 1024

export interface ChatCompletionsOptions {
  apiKey: string
  modelId: string
  baseUrl: string
  /** Provider-specific extras, such as OpenRouter's attribution headers. */
  headers?: Record<string, string>
  fetchImpl?: typeof fetch
}

interface ChatCompletionsResponse {
  id?: string
  model?: string
  provider?: string
  error?: { message?: string; code?: number | string }
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

export function makeChatCompletionsClient(opts: ChatCompletionsOptions): ModelClient {
  const doFetch = opts.fetchImpl ?? fetch

  return {
    modelId: opts.modelId,
    async complete(userPrompt, signal) {
      const res = await doFetch(opts.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${opts.apiKey}`,
          ...opts.headers,
        },
        signal,
        body: JSON.stringify({
          model: opts.modelId,
          max_tokens: MAX_TOKENS_JSON,
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
        throw new Error(`${opts.modelId} returned ${res.status}: ${body.slice(0, 200)}`)
      }

      const json = (await res.json()) as ChatCompletionsResponse

      // A 200 carrying an error, or carrying no choices at all. Both are the
      // upstream failing, not the model answering badly.
      if (json.error) {
        throw new Error(`${opts.modelId} failed: ${json.error.message ?? JSON.stringify(json.error)}`)
      }
      const choice = json.choices?.[0]
      if (!choice) {
        throw new Error(`${opts.modelId} returned no choices`)
      }
      // A reply cut off at the token limit is usually truncated JSON, which
      // would fail the parser with a message pointing at the wrong problem.
      if (choice.finish_reason === "length") {
        throw new Error(`${opts.modelId} stopped at the ${MAX_TOKENS_JSON} token limit`)
      }

      return {
        raw: choice.message?.content ?? "",
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
        },
        // OpenRouter names the upstream that actually served the call, and a
        // week scored through two different upstreams is worth being able to
        // see when someone disputes a line.
        requestId: json.provider ? `${json.id ?? "?"}@${json.provider}` : json.id,
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

/** DeepSeek direct. */
export function makeDeepseekClient(opts: DeepseekOptions): ModelClient {
  return makeChatCompletionsClient({
    apiKey: opts.apiKey,
    modelId: opts.modelId ?? DEEPSEEK_DEFAULT_MODEL,
    baseUrl: opts.baseUrl ?? DEEPSEEK_API,
    fetchImpl: opts.fetchImpl,
  })
}

/* ────────────────────────────── openrouter ───────────────────────────────── */

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions"

/**
 * The default when routing through OpenRouter.
 *
 * Named with its vendor prefix, which OpenRouter requires and which is worth
 * the noise: the id lands on every audit row, so "which model scored this
 * week" is answerable without also knowing how the worker was configured.
 */
export const OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-chat"

export interface OpenRouterOptions {
  apiKey: string
  /** Vendor-prefixed, e.g. `deepseek/deepseek-chat`, `anthropic/claude-sonnet-4.5`. */
  modelId?: string
  baseUrl?: string
  /** Shown on OpenRouter's dashboard next to the spend. */
  appUrl?: string
  appTitle?: string
  fetchImpl?: typeof fetch
}

/**
 * OpenRouter, which fronts DeepSeek, Anthropic and most others behind one key.
 *
 * The routing is the thing to be careful about rather than the protocol. Asking
 * for a model by name can be served by more than one upstream, and two upstreams
 * serving the same weights do not always answer identically. The provider that
 * served each call is recorded, so a week is auditable even when it was not
 * scored by one machine throughout.
 */
export function makeOpenRouterClient(opts: OpenRouterOptions): ModelClient {
  // Fixed for this app rather than configurable. They only label the spend on
  // OpenRouter's own dashboard, and a per-deployment value would make the
  // scoring bill harder to read, not easier.
  const headers: Record<string, string> = {
    "http-referer": opts.appUrl ?? "https://berth.club",
    "x-title": opts.appTitle ?? "Harbormaster",
  }

  return makeChatCompletionsClient({
    apiKey: opts.apiKey,
    modelId: opts.modelId ?? OPENROUTER_DEFAULT_MODEL,
    baseUrl: opts.baseUrl ?? OPENROUTER_API,
    headers,
    fetchImpl: opts.fetchImpl,
  })
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
 * several keys are present. An explicit provider whose key is missing returns
 * nothing rather than quietly falling through to another one: the week waiting
 * is recoverable, a week scored by a model the operator did not choose is not.
 *
 * With no provider named, the order is OpenRouter, Anthropic, DeepSeek. It only
 * ever picks from keys that are actually set, and no key at all means no
 * scoring rather than a crash.
 */
export function pickClient(cfg: {
  provider?: string
  anthropicApiKey?: string
  deepseekApiKey?: string
  openrouterApiKey?: string
  modelId?: string
  appUrl?: string
  appTitle?: string
}): ModelClient | null {
  const openrouter = () =>
    cfg.openrouterApiKey
      ? makeOpenRouterClient({
          apiKey: cfg.openrouterApiKey,
          modelId: cfg.modelId,
          appUrl: cfg.appUrl,
          appTitle: cfg.appTitle,
        })
      : null
  const anthropic = () =>
    cfg.anthropicApiKey
      ? makeAnthropicClient({ apiKey: cfg.anthropicApiKey, modelId: cfg.modelId })
      : null
  const deepseek = () =>
    cfg.deepseekApiKey
      ? makeDeepseekClient({ apiKey: cfg.deepseekApiKey, modelId: cfg.modelId })
      : null

  switch (cfg.provider?.toLowerCase()) {
    case "openrouter":
      return openrouter()
    case "anthropic":
      return anthropic()
    case "deepseek":
      return deepseek()
    case undefined:
    case "":
      return openrouter() ?? anthropic() ?? deepseek()
    default:
      // A misspelled provider is a configuration mistake. Scoring the week with
      // whatever else happens to be configured would hide it.
      return null
  }
}
