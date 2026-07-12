/**
 * Minimal OpenAI-compatible chat-completions client (over global `fetch`).
 *
 * Works with any endpoint that speaks `/v1/chat/completions`: Groq's free tier,
 * OpenRouter's free models, a local Ollama, self-hosted vLLM, etc. — so the
 * synthesis layer can run on an open-source / free-tier model without a
 * proprietary dependency. Configured via LLM_BASE_URL / LLM_API_KEY / LLM_MODEL.
 */

export interface LlmClientOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

export class LlmClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: LlmClientOptions) {
    // Normalize so both ".../v1" and ".../v1/" work.
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  static isConfigured(baseUrl: string, model: string): boolean {
    return Boolean(baseUrl && model);
  }

  /** Single-shot completion. Returns the assistant message text. */
  async complete(system: string, user: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json: any = await res.json();
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw new Error('LLM returned an empty completion');
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}
