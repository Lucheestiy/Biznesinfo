import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/origin";
import { getClientIp, rateLimit } from "@/lib/security/rateLimit";
import { getCurrentUser, isAuthEnabled } from "@/lib/auth/currentUser";
import { getUserEffectivePlan } from "@/lib/auth/plans";
import {
  AiUploadValidationError,
  AudioTranscriptionConfigurationError,
  transcribeAiAudioFile,
} from "@/lib/ai/uploads";

export const runtime = "nodejs";

const AI_TRANSCRIBE_MAX_CHARS = 6_000;

export async function POST(request: Request) {
  if (!isAuthEnabled()) return NextResponse.json({ error: "AuthDisabled" }, { status: 404 });

  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "CSRF" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const effective = await getUserEffectivePlan(user);
  if (effective.plan === "free") {
    return NextResponse.json({ error: "UpgradeRequired", plan: effective.plan }, { status: 403 });
  }

  const ip = getClientIp(request);
  const rl = rateLimit({ key: `ai:transcribe:${user.id}:${ip}`, limit: 20, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "RateLimited" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "BadRequest" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "BadRequest", field: "file" }, { status: 400 });
  }

  try {
    const result = await transcribeAiAudioFile({ file, maxChars: AI_TRANSCRIBE_MAX_CHARS });
    return NextResponse.json({
      success: true,
      text: result.text,
      truncated: result.truncated,
      mimeType: result.mimeType,
    });
  } catch (error) {
    if (error instanceof AiUploadValidationError) {
      return NextResponse.json(
        {
          error: "InvalidFile",
          code: error.code,
          fileName: error.fileName,
          message: error.message,
        },
        { status: 400 },
      );
    }
    if (error instanceof AudioTranscriptionConfigurationError) {
      return NextResponse.json(
        {
          error: "TranscriptionUnavailable",
          message: "Серверная расшифровка аудио сейчас недоступна.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "TranscriptionFailed" }, { status: 500 });
  }
}
