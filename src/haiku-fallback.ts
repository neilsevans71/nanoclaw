/**
 * Haiku Fallback — Hybrid approach: try Gemma locally, require user approval for Haiku
 * Detects when Gemma can't answer and prompts user before calling Haiku API (cost control)
 */

export interface FallbackApproval {
  chatJid: string;
  userMessage: string;
  gemmaResponse: string;
  expiresAt: number; // timestamp when approval expires (5 min)
  conversationHistory: ClaudeMessage[];
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Detect if Gemma's response indicates failure/inability to answer
 */
export function isGemmaFailure(response: string): boolean {
  const failurePatterns = [
    /can't provide real-time/i,
    /don't have access to/i,
    /don't have real-time/i,
    /unable to.*weather/i,
    /not connected to.*api/i,
    /^```(python|javascript|code)/, // Starts with code block
    /^print\(/, // Starts with print statement
    /i'm not able to/i,
    /as an ai.*can't/i,
    /as a language model.*can't/i,
  ];

  return failurePatterns.some((pattern) => pattern.test(response));
}

/**
 * Call Claude Haiku as fallback for complex queries
 * Returns both text and token usage (for cost tracking)
 */
export async function callHaikuFallback(
  userMessage: string,
  conversationHistory: ClaudeMessage[] = [],
  apiKey?: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const messages: ClaudeMessage[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1024,
      system: `You are Clawdia, a helpful personal assistant. Be brief, friendly, and casual.
Keep responses under 200 words. Help with questions, tasks, and general chat.

Just respond naturally and conversationally.`,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Haiku API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  const textContent = data.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Haiku response');
  }

  return {
    text: textContent.text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

/**
 * Request user approval for Haiku fallback (cost control)
 * Returns approval prompt message for user
 */
export function getApprovalPrompt(): string {
  return 'Gemma2 is unable to answer this query. Use Claude Haiku API instead? (/haiku yes or /haiku no)';
}

/**
 * Generate usage summary from Haiku response (tokens + cost)
 */
export function formatUsageSummary(
  inputTokens: number,
  outputTokens: number,
): string {
  // Haiku pricing: $0.80/M input tokens, $4.00/M output tokens
  const inputCost = (inputTokens / 1_000_000) * 0.8;
  const outputCost = (outputTokens / 1_000_000) * 4.0;
  const totalCost = inputCost + outputCost;

  return `📊 API Usage:
Input tokens: ${inputTokens}
Output tokens: ${outputTokens}
Estimated cost: $${totalCost.toFixed(5)}
Model: claude-3-5-haiku-20241022`;
}

/**
 * Smart responder: try Gemma first, require user approval for Haiku fallback
 * Returns { response, usedHaiku, needsApproval, approval? }
 */
export async function smartRespond(
  userMessage: string,
  gemmaResponse: string,
  conversationHistory: ClaudeMessage[] = [],
): Promise<{ response: string; usedHaiku: boolean; needsApproval?: boolean }> {
  // If Gemma gave a good response, use it
  if (!isGemmaFailure(gemmaResponse)) {
    return { response: gemmaResponse, usedHaiku: false };
  }

  // Gemma failed — signal that approval is needed, don't auto-call Haiku
  return {
    response: getApprovalPrompt(),
    usedHaiku: false,
    needsApproval: true,
  };
}

/**
 * Execute Haiku fallback after user approval
 * Includes usage summary in response for cost transparency
 */
export async function executeHaikuFallback(
  userMessage: string,
  conversationHistory: ClaudeMessage[] = [],
  apiKey?: string,
): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
  const result = await callHaikuFallback(
    userMessage,
    conversationHistory,
    apiKey,
  );
  const usageSummary = formatUsageSummary(
    result.inputTokens,
    result.outputTokens,
  );
  return {
    response: `${result.text}\n\n${usageSummary}`,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}
