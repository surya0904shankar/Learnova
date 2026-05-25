import { jsonSuccess, jsonError } from "@/lib/api-response";
import {
  authenticateRequest,
  withErrorHandler,
} from "@/lib/error-handler";
import { ValidationError, AppError } from "@/lib/errors";
import { callGroq, validateGroqBody } from "@/lib/ai/groq";

export const dynamic = "force-dynamic";

import { checkRateLimit } from "@/lib/rateLimit";
import { detectInjection, sanitizeMessage, buildSecureMessages } from "@/utils/promptGuard";

// Use shared validators/helpers from `lib/ai/groq`

export async function POST(request) {
  try {
    const decodedToken =
      await authenticateRequest(request);

    // Rate limiting
    const rateLimitResult = await checkRateLimit(decodedToken.uid);
    if (!rateLimitResult.allowed) {
      return jsonError(
        "Too many requests. Please try again later.",
        429
      );
    }

    // Parse and validate body using shared validator
    const body = await request.json();
    const { trimmedMessage } = validateGroqBody(body);

    // Check for prompt injection
    const injectionCheck = detectInjection(trimmedMessage);
    if (injectionCheck.isInjection) {
      console.warn(`[nova-ai-safety] Injection blocked for user ${decodedToken.uid}: ${injectionCheck.matchedPattern}`);
      return jsonError("Safety check: System instructions override or prompt injection attempt detected.", 400);
    }

    // Sanitize user message
    const sanitizedMessage = sanitizeMessage(trimmedMessage);

    // API key
    const apiKey =
      process.env.GROQ_API_KEY;

    if (!apiKey) {
      throw new AppError(
        "Groq API key is not configured",
        500
      );
    }

    // Call shared Groq helper which handles request/timeout/errors
    const content = await callGroq(sanitizedMessage);

    return jsonSuccess({ message: content });
  } catch (err) {
    return jsonError(err?.message || "Server error", 500);
  }
}
