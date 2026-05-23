import { jsonSuccess } from "@/lib/api-response";
import { detectInjection, sanitizeMessage, buildSecureMessages } from "@/utils/promptGuard";
import { checkRateLimit } from "@/lib/rateLimit";
import { withErrorHandler, authenticateRequest } from "@/lib/error-handler";
import { AppError, ValidationError } from "@/lib/errors";
import logger from "@/utils/logger"; // Import the central Winston logger

export const dynamic = "force-dynamic";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_MESSAGE_LENGTH = 2000;
const SYSTEM_PROMPT =
  "You are Nova, the friendly AI assistant for Learnova - a Smart Student Engagement Ecosystem. You help with questions about attendance automation, smart activities, security features, analytics, and educational technology. Always be helpful, informative, and encouraging. Keep responses concise but comprehensive.";

/**
 * Handles incoming chat completions requests using the Groq AI SDK.
 * Secured via Firebase Bearer Token authentication to prevent API resource abuse,
 * billing spikes, and unauthorized client consumption. Includes per-user rate limiting.
 * 
 * @param {Request} request - The incoming HTTP POST request.
 * @returns {Promise<Response>} JSON response containing completion results or an error payload.
 */
export const POST = withErrorHandler(async (request) => {
  const decodedToken = await authenticateRequest(request);

  // Rate limiting per authenticated user (persisted across cold starts)
  const rateLimit = await checkRateLimit(decodedToken.uid);
  if (!rateLimit.allowed) {
    throw new AppError("Too many requests. Please try again later.", 429);
  }

  const { message, userMessage } = await request.json();
  const rawMessage = typeof message === "string" ? message : userMessage;
  const trimmedMessage = rawMessage?.trim();

  if (!trimmedMessage) {
    throw new ValidationError("Message is required");
  }

  if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError("Message is too long");
  }

  const { isInjection, matchedPattern } = detectInjection(trimmedMessage);
  if (isInjection) {
    // FIX: Replaced raw console.warn with centralized, structured logger
    logger.warn({
      message: "Prompt injection attempt blocked",
      uid: decodedToken.uid,
      pattern: matchedPattern,
    });
    throw new ValidationError("Your message contains content that violates usage policies. Please rephrase your question.");
  }

  const cleanMessage = sanitizeMessage(trimmedMessage);
  if (!cleanMessage) {
    throw new ValidationError("Message is required");
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new AppError("Groq API key is not configured", 500);
  }

  const timeoutMs = parseInt(process.env.GROQ_TIMEOUT || "30000", 10) || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const messages = buildSecureMessages(cleanMessage, SYSTEM_PROMPT);

  let response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages,
        max_tokens: 400,
        temperature: 0.7,
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorBody;
    try {
      errorBody = await response.json();
    } catch (parseError) {
      // FIX: Removed empty catch logic that hid internal downstream parsing failures
      logger.error({
        message: "Failed to parse Groq error response JSON body",
        error: parseError.message,
      });
      errorBody = null;
    }

    throw new AppError(
      errorBody?.error?.message || `Groq downstream request failed with status ${response.status}`,
      response.status
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new AppError("Groq response was empty", 502);
  }

  // Optional: Structured info log for audit tracking tracking
  logger.info({
    message: "Groq completion generated successfully",
    uid: decodedToken.uid,
  });

  return jsonSuccess({ message: content });
});