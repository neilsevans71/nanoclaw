/**
 * Haiku Fallback — Hybrid approach: try Gemma locally, fall back to Claude Haiku if needed
 * Detects when Gemma can't answer and automatically calls Haiku (Claude API)
 */

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
 */
export async function callHaikuFallback(
  userMessage: string,
  conversationHistory: ClaudeMessage[] = [],
  apiKey?: string,
): Promise<string> {
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
      system: `You are Andy, a helpful personal assistant. Be brief, friendly, and casual.
Keep responses under 200 words. Help with weather, reminders, todos, and general chat.

For weather: If asked about weather, provide actual information if available.
For reminders: Help create and manage reminders. Be conversational, not formal.
For todos: Help organize and list tasks naturally.

Just talk naturally. Don't show code or explain what you're doing unless asked.`,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Haiku API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  const textContent = data.content.find((c) => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text content in Haiku response');
  }

  return textContent.text;
}

/**
 * Smart responder: try Gemma first, fall back to Haiku if it fails
 */
export async function smartRespond(
  userMessage: string,
  gemmaResponse: string,
  conversationHistory: ClaudeMessage[] = [],
): Promise<{ response: string; usedHaiku: boolean }> {
  // If Gemma gave a good response, use it
  if (!isGemmaFailure(gemmaResponse)) {
    return { response: gemmaResponse, usedHaiku: false };
  }

  // Gemma failed, try Haiku
  try {
    const haikuResponse = await callHaikuFallback(
      userMessage,
      conversationHistory,
    );
    return { response: haikuResponse, usedHaiku: true };
  } catch (err) {
    // Haiku also failed, return Gemma's response as last resort
    console.error(
      `Haiku fallback failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { response: gemmaResponse, usedHaiku: false };
  }
}
