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
