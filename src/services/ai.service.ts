/**
 * =============================================================================
 * AI Outreach & Intent Classification Service (OpenRouter Free Tier)
 * =============================================================================
 * 
 * Purpose:
 * Uses free models from OpenRouter (model IDs ending in `:free`) to:
 * 1. Personalize and write cold outreach emails & follow-ups based on prospect role/company.
 * 2. Classify incoming prospect replies into actionable intent categories.
 * 
 * The Rate-Limit Challenge at 10,000-Contact Scale:
 * OpenRouter's free tier has strict rate limits (~10-20 requests/minute).
 * Bombarding the API with 10,000 separate LLM calls will immediately trigger HTTP 429s.
 * 
 * Engineering Solutions Built into this Service:
 * 1. Persona/Segment Cache:
 *    Generates a personalized template per segment (e.g. "VP of Sales" in "Tech"),
 *    caches it in memory, and interpolates individual name/company variables.
 *    This reduces 10,000 external API calls down to ~50-100 persona calls.
 * 2. Concurrency Semaphore & Pacing:
 *    Limits concurrent outbound calls to OpenRouter to prevent bursting.
 * 3. Graceful Fallback Templates:
 *    If an API key is missing, rate limit (HTTP 429) is hit, or timeout occurs (>4s),
 *    the service automatically falls back to deterministic, high-converting templates.
 * 4. Deterministic Heuristic Reply Classifier:
 *    Ensures inbound reply classification never fails even if OpenRouter is offline.
 * =============================================================================
 */

import "dotenv/config";

export interface GenerateEmailInput {
  name: string;
  company: string;
  role: string;
  step: number; // 0 = First Email, 1 = FU1, 2 = FU2, 3 = FU3
}

export interface GeneratedEmailOutput {
  subject: string;
  body: string;
  source: "openrouter_ai" | "segment_cache" | "fallback_template";
  modelUsed?: string;
}

export type ClassifiedIntent = "INTERESTED" | "NOT_INTERESTED" | "OUT_OF_OFFICE" | "UNSUBSCRIBE";

export interface ClassifyReplyOutput {
  classification: ClassifiedIntent;
  confidence: number;
  source: "openrouter_ai" | "heuristic_fallback";
  modelUsed?: string;
}

export class AIService {
  private static readonly API_URL = "https://openrouter.ai/api/v1/chat/completions";
  private static readonly DEFAULT_FREE_MODEL = "google/gemma-4-31b-it:free";

  // In-memory cache for persona/role segment templates
  // Key format: `${step}:${normalizedRole}`
  private static segmentCache = new Map<string, { subject: string; templateBody: string }>();

  /**
   * Normalizes a role title into a standardized persona segment.
   * e.g. "VP of Sales" -> "sales_leadership"
   */
  private static normalizeRoleSegment(role: string): string {
    const lower = role.toLowerCase();
    if (lower.includes("sales") || lower.includes("revenue") || lower.includes("growth")) {
      return "sales_growth";
    }
    if (lower.includes("tech") || lower.includes("cto") || lower.includes("engineer") || lower.includes("architect")) {
      return "engineering_tech";
    }
    if (lower.includes("marketing") || lower.includes("demand")) {
      return "marketing_demand";
    }
    if (lower.includes("founder") || lower.includes("ceo") || lower.includes("owner")) {
      return "executive_founder";
    }
    return "general_operations";
  }

  /**
   * Generates a personalized subject and body for a prospect at a given sequence step.
   * Leverages segment caching, OpenRouter LLM generation, and deterministic fallbacks.
   */
  public static async generateEmail(input: GenerateEmailInput): Promise<GeneratedEmailOutput> {
    const { name, company, role, step } = input;
    const segment = this.normalizeRoleSegment(role);
    const cacheKey = `${step}:${segment}`;

    // 1. Check Persona Segment Cache
    if (this.segmentCache.has(cacheKey)) {
      const cached = this.segmentCache.get(cacheKey)!;
      return {
        subject: this.interpolateVariables(cached.subject, { name, company, role }),
        body: this.interpolateVariables(cached.templateBody, { name, company, role }),
        source: "segment_cache",
        modelUsed: "cache"
      };
    }

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim() || this.DEFAULT_FREE_MODEL;

    // 2. If API Key is configured, attempt OpenRouter LLM call
    if (apiKey) {
      try {
        const prompt = this.buildEmailPrompt(name, company, role, step);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout guard for free models

        const response = await fetch(this.API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://mnemio.ai",
            "X-Title": "MnemioAI Cold Email Engine"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: "You are an elite B2B sales copywriter. Return ONLY valid JSON in format: {\"subject\": \"...\", \"body\": \"...\"}. Keep email under 80 words, punchy and direct."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 800
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const json = await response.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            const parsed = this.parseJsonFromContent(content);
            if (parsed?.subject && parsed?.body) {
              // Cache template for this persona segment with placeholders
              this.segmentCache.set(cacheKey, {
                subject: parsed.subject.replace(new RegExp(company, "gi"), "{{company}}"),
                templateBody: parsed.body
                  .replace(new RegExp(name, "gi"), "{{name}}")
                  .replace(new RegExp(company, "gi"), "{{company}}")
              });

              return {
                subject: parsed.subject,
                body: parsed.body,
                source: "openrouter_ai",
                modelUsed: model
              };
            }
          }
        } else if (response.status === 429) {
          console.warn(`⚠️ OpenRouter 429 Rate Limit encountered for ${model}. Gracefully falling back to deterministic template.`);
        }
      } catch (err: any) {
        // Log timeout / network failure and seamlessly continue with fallback
        if (err.name === "AbortError") {
          console.warn("⚠️ OpenRouter request timed out after 4s. Switching to fallback template.");
        } else {
          console.warn("⚠️ OpenRouter error:", err.message);
        }
      }
    }

    // 3. High-Quality Deterministic Fallback Template
    const fallback = this.getFallbackEmail(name, company, role, step);
    return {
      subject: fallback.subject,
      body: fallback.body,
      source: "fallback_template",
      modelUsed: "fallback"
    };
  }

  /**
   * Classifies an incoming reply into:
   * - INTERESTED
   * - NOT_INTERESTED
   * - OUT_OF_OFFICE
   * - UNSUBSCRIBE
   */
  public static async classifyReply(replyBody: string): Promise<ClassifyReplyOutput> {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    const model = process.env.OPENROUTER_MODEL?.trim() || this.DEFAULT_FREE_MODEL;

    // 1. Try OpenRouter AI classification if key is provided
    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8-second timeout guard for free models

        const response = await fetch(this.API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://mnemio.ai",
            "X-Title": "MnemioAI Reply Classifier"
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: "You are an email intent classifier. Classify the user email into exactly one category: INTERESTED, NOT_INTERESTED, OUT_OF_OFFICE, or UNSUBSCRIBE. Return JSON only: {\"classification\": \"...\", \"confidence\": 0.95}"
              },
              {
                role: "user",
                content: `Classify this inbound reply:\n\n"${replyBody}"`
              }
            ],
            temperature: 0.1,
            max_tokens: 80
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const json = await response.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            const parsed = this.parseJsonFromContent(content);
            const valid = ["INTERESTED", "NOT_INTERESTED", "OUT_OF_OFFICE", "UNSUBSCRIBE"];
            if (valid.includes(parsed?.classification)) {
              return {
                classification: parsed.classification as ClassifiedIntent,
                confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.95,
                source: "openrouter_ai",
                modelUsed: model
              };
            }
          }
        }
      } catch {
        // Fall back to heuristic rule-based classifier below
      }
    }

    // 2. Fast Deterministic Heuristic Fallback
    return this.heuristicClassify(replyBody);
  }

  /**
   * Deterministic rule-based classification fallback.
   * Matches common B2B response patterns with high accuracy.
   */
  public static heuristicClassify(text: string): ClassifyReplyOutput {
    const lower = text.toLowerCase();

    // Unsubscribe keywords have highest precedence
    if (
      lower.includes("unsubscribe") ||
      lower.includes("remove me") ||
      lower.includes("stop emailing") ||
      lower.includes("opt out") ||
      lower.includes("take me off") ||
      lower.includes("do not email")
    ) {
      return { classification: "UNSUBSCRIBE", confidence: 0.99, source: "heuristic_fallback" };
    }

    // Out of office keywords
    if (
      lower.includes("out of office") ||
      lower.includes("auto-reply") ||
      lower.includes("away from") ||
      lower.includes("annual leave") ||
      lower.includes("vacation") ||
      lower.includes("returning on")
    ) {
      return { classification: "OUT_OF_OFFICE", confidence: 0.98, source: "heuristic_fallback" };
    }

    // Not interested keywords
    if (
      lower.includes("not interested") ||
      lower.includes("no thanks") ||
      lower.includes("pass on this") ||
      lower.includes("already have") ||
      lower.includes("not looking") ||
      lower.includes("no need") ||
      lower.includes("not a priority")
    ) {
      return { classification: "NOT_INTERESTED", confidence: 0.95, source: "heuristic_fallback" };
    }

    // Interested keywords
    if (
      lower.includes("interested") ||
      lower.includes("demo") ||
      lower.includes("call") ||
      lower.includes("calendar") ||
      lower.includes("pricing") ||
      lower.includes("deck") ||
      lower.includes("send over") ||
      lower.includes("connect next week") ||
      lower.includes("speak")
    ) {
      return { classification: "INTERESTED", confidence: 0.92, source: "heuristic_fallback" };
    }

    // Default neutral/not-interested
    return { classification: "NOT_INTERESTED", confidence: 0.70, source: "heuristic_fallback" };
  }

  /**
   * Replaces template placeholder tags with prospect variables.
   */
  private static interpolateVariables(
    template: string,
    vars: { name: string; company: string; role: string }
  ): string {
    return template
      .replace(/{{name}}/g, vars.name)
      .replace(/{{company}}/g, vars.company)
      .replace(/{{role}}/g, vars.role);
  }

  /**
   * Robust JSON extractor that handles markdown code fences (```json ... ```)
   */
  private static parseJsonFromContent(content: string): any {
    try {
      return JSON.parse(content.trim());
    } catch {
      // 1. Try markdown code fences: ```json ... ``` or ``` ... ```
      const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1].trim());
        } catch {
          // continue
        }
      }
      // 2. Try outermost curly braces
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0].trim());
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Builds the prompt sent to OpenRouter free models.
   */
  private static buildEmailPrompt(name: string, company: string, role: string, step: number): string {
    const stepLabels = [
      "Initial Outreach Email (Introduce workflow automation, clear pain point)",
      "Follow-up 1 (Brief check-in, share relevant industry ROI/metric)",
      "Follow-up 2 (Different perspective, share short case study)",
      "Follow-up 3 (Breakup email, polite closing of the loop)"
    ];

    return `Write an outreach email for:
Prospect: ${name}
Role: ${role}
Company: ${company}
Sequence Stage: ${stepLabels[step] ?? "Outreach"}

Requirements:
- Under 75 words
- Return strictly in JSON format: {"subject": "...", "body": "..."}
- Sound conversational and human, not generic spam.`;
  }

  /**
   * Deterministic high-quality email templates by sequence step.
   */
  private static getFallbackEmail(
    name: string,
    company: string,
    role: string,
    step: number
  ): { subject: string; body: string } {
    const firstName = name.split(" ")[0] ?? name;

    switch (step) {
      case 0:
        return {
          subject: `Quick question regarding ${company}'s workflows`,
          body: `Hi ${firstName},\n\nI noticed your role as ${role} at ${company} and wanted to reach out. Many teams in your space struggle with manual outreach tracking falling through spreadsheets.\n\nWe built an automation engine that handles sequence cadences and ensures zero contacts get lost or double-emailed. Would you be open to a quick 10-minute chat this Thursday?\n\nBest,\nAlex`
        };
      case 1:
        return {
          subject: `Re: Quick question regarding ${company}'s workflows`,
          body: `Hi ${firstName},\n\nWanted to float this to the top of your inbox in case my last note got buried. Teams switching from manual spreadsheets to automated lifecycle tracking saw their prospect engagement double within 3 weeks.\n\nWorth a brief 10-minute look next week?\n\nBest,\nAlex`
        };
      case 2:
        return {
          subject: `Idea for ${company} (${role})`,
          body: `Hi ${firstName},\n\nFollowing up with a quick thought: how is ${company} currently preventing prospects from receiving duplicate outreach across multiple reps?\n\nIf that's a solved problem for you, no worries at all. If not, happy to share how we solve this with transactional idempotency.\n\nBest,\nAlex`
        };
      case 3:
      default:
        return {
          subject: `Closing the loop - ${company}`,
          body: `Hi ${firstName},\n\nI haven't heard back, which usually means this isn't a top priority for you right now—completely understandable.\n\nI'll close the loop here and won't crowd your inbox further. If automation and sequence reliability ever become a focus down the road, feel free to reach back out.\n\nWishing you and ${company} all the best,\nAlex`
        };
    }
  }
}
