import { NextResponse } from "next/server";
import { getOpenAI } from "@/lib/openai";
import { generateWithOllama } from "@/lib/ollama";
import { buildGenerationInstructions } from "@/lib/prompts";
import { contentPlaybook } from "@/lib/content-playbook";
import { formatSocialText } from "@/lib/social-format";
import type { ContentGoal, GenerationMode } from "@/lib/types";

const DEFAULT_OPENAI_TEXT_MODEL = "gpt-6-luna";

function extractJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "");

  return JSON.parse(cleaned);
}

function ensureRequiredHashtags(text: string) {
  const result = text.trim();

  const missing = contentPlaybook.requiredHashtags.filter((hashtag) => {
    const escaped = hashtag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "i").test(result);
  });

  if (!missing.length) {
    return result;
  }

  return `${result}\n\n${missing.join(" ")}`.trim();
}

async function generateWithOpenAI({
  instructions,
  input,
}: {
  instructions: string;
  input: string;
}) {
  const model = process.env.OPENAI_TEXT_MODEL || DEFAULT_OPENAI_TEXT_MODEL;
  const client = getOpenAI();

  const response = await client.responses.create({
    model,
    instructions,
    input,
  });

  return response.output_text;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      topic,
      notes = "",
      imageChoice = "generate",
      mode = "both",
      feedback = "",
      currentDraft = "",
      contentGoal = "trust-growth",
    } = body as {
      topic?: string;
      notes?: string;
      imageChoice?: string;
      mode?: GenerationMode;
      feedback?: string;
      currentDraft?: string;
      contentGoal?: ContentGoal;
    };

    if (!topic?.trim()) {
      return NextResponse.json({ error: "Topic is required." }, { status: 400 });
    }

    if (!["both", "linkedin", "x"].includes(mode)) {
      return NextResponse.json({ error: "Invalid generation mode." }, { status: 400 });
    }

    if (!["trust-growth", "authority", "engagement", "education"].includes(contentGoal)) {
      return NextResponse.json({ error: "Invalid content goal." }, { status: 400 });
    }

    const instructions = buildGenerationInstructions({
      mode,
      contentGoal,
      feedback,
      currentDraft,
    });

    const input = [
      `Topic: ${topic.trim()}`,
      notes ? `Additional notes/context: ${notes.trim()}` : "",
      `Content goal: ${contentGoal}`,
      `Image preference: ${imageChoice}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const provider = (process.env.AI_PROVIDER || "ollama").toLowerCase();

    let raw =
      provider === "openai"
        ? await generateWithOpenAI({ instructions, input })
        : await generateWithOllama({
            system: instructions,
            user: input,
            timeoutMs: 90000,
          });

    let parsed = extractJson(raw);

    let linkedinRaw = formatSocialText(
      String(parsed.linkedin ?? ""),
      "linkedin"
    );
    let xRaw = formatSocialText(String(parsed.x ?? ""), "x");

    let linkedin = linkedinRaw ? ensureRequiredHashtags(linkedinRaw) : "";
    let x = xRaw ? ensureRequiredHashtags(xRaw) : "";

    const missingRequiredDraft =
      (mode === "both" && (!linkedin || !x)) ||
      (mode === "linkedin" && !linkedin) ||
      (mode === "x" && !x);

    if (missingRequiredDraft) {
      const missingLinkedIn =
        (mode === "both" || mode === "linkedin") && !linkedin;
      const missingX = (mode === "both" || mode === "x") && !x;

      const recoveryMode: GenerationMode =
        missingLinkedIn && missingX
          ? "both"
          : missingLinkedIn
            ? "linkedin"
            : "x";

      console.warn(
        `AI returned an incomplete draft. Auto-retrying: ${recoveryMode}`
      );

      const recoveryInstructions = [
        "You are repairing an incomplete social-media draft.",
        "Return ONLY valid JSON with exactly these keys: linkedin, x, imageConcept, contextUsed.",
        `Generate mode: ${recoveryMode}.`,
        recoveryMode === "both"
          ? "linkedin and x must both be non-empty."
          : `${recoveryMode} must be non-empty; leave the other platform as an empty string.`,
        "Use simple natural English and a strong hook.",
        "LinkedIn: short paragraphs, 3-5 useful points or clean • bullets, no asterisk list bullets.",
        "LinkedIn may use *short phrase* only as an internal emphasis marker.",
        "X: plain text and concise.",
        `Always leave room for ${contentPlaybook.requiredHashtags.join(" ")}.`,
        "Never invent a client, metric, employer, result, or personal story.",
      ].join("\n");

      const recoveryInput = [
        `Topic: ${topic.trim()}`,
        notes ? `Additional notes/context: ${notes.trim()}` : "",
        feedback ? `Requested change: ${feedback.trim()}` : "",
        `Content goal: ${contentGoal}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      raw =
        provider === "openai"
          ? await generateWithOpenAI({
              instructions: recoveryInstructions,
              input: recoveryInput,
            })
          : await generateWithOllama({
              system: recoveryInstructions,
              user: recoveryInput,
              timeoutMs: 45000,
            });

      const recoveredParsed = extractJson(raw);

      if (missingLinkedIn) {
        linkedinRaw = formatSocialText(
          String(recoveredParsed.linkedin ?? ""),
          "linkedin"
        );
        linkedin = linkedinRaw ? ensureRequiredHashtags(linkedinRaw) : "";
      }

      if (missingX) {
        xRaw = formatSocialText(String(recoveredParsed.x ?? ""), "x");
        x = xRaw ? ensureRequiredHashtags(xRaw) : "";
      }

      parsed = {
        ...parsed,
        imageConcept:
          parsed.imageConcept || recoveredParsed.imageConcept || "",
        contextUsed:
          Array.isArray(parsed.contextUsed) && parsed.contextUsed.length
            ? parsed.contextUsed
            : recoveredParsed.contextUsed || [],
      };

      const stillMissing =
        (mode === "both" && (!linkedin || !x)) ||
        (mode === "linkedin" && !linkedin) ||
        (mode === "x" && !x);

      if (stillMissing) {
        console.error("AI remained incomplete after automatic retry:", {
          mode,
          parsed,
          recoveredParsed,
        });

        return NextResponse.json(
          {
            error:
              "The local model could not complete the draft after an automatic retry. Try once more; if this keeps happening, switch to a larger Ollama model.",
          },
          {
            status: 502,
            headers: { "Cache-Control": "no-store" },
          }
        );
      }
    }

    const contextUsed = Array.isArray(parsed.contextUsed)
      ? parsed.contextUsed.map(String).slice(0, 8)
      : [];

    return NextResponse.json(
      {
        linkedin,
        x,
        imageConcept: String(parsed.imageConcept ?? ""),
        contextUsed,
        provider,
        generatedAt: new Date().toISOString(),
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error(error);

    const rawMessage = error instanceof Error ? error.message : "";

    let message = "Generation failed. Check the server terminal and try again.";

    if (rawMessage.includes("Cannot connect to Ollama")) {
      message =
        "Cannot connect to Ollama. Keep Ollama running locally and try again.";
    } else if (rawMessage.includes("OPENAI_API_KEY")) {
      message =
        "OPENAI_API_KEY is not configured. Either use Ollama or configure OpenAI.";
    } else if (
      rawMessage.includes("credit_balance_exhausted") ||
      rawMessage.includes("insufficient_quota") ||
      rawMessage.includes("no credits")
    ) {
      message =
        "OpenAI API credits are unavailable. Switch AI_PROVIDER to ollama for free local generation.";
    } else if (rawMessage.includes("Ollama timed out")) {
      message = rawMessage;
    } else if (
      rawMessage.includes("JSON") ||
      rawMessage.includes("Unexpected token")
    ) {
      message =
        "The local model returned an invalid response format. Try Generate again.";
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
