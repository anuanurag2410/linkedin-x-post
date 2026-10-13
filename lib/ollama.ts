type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

const SOCIAL_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    linkedin: { type: "string" },
    x: { type: "string" },
    imageConcept: { type: "string" },
    contextUsed: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["linkedin", "x", "imageConcept", "contextUsed"],
  additionalProperties: false,
} as const;

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "gemma3:4b";

export async function generateWithOllama({
  system,
  user,
  format = SOCIAL_DRAFT_SCHEMA,
  temperature = 0.45,
  timeoutMs = 90000,
}: {
  system: string;
  user: string;
  format?: object | "json";
  temperature?: number;
  timeoutMs?: number;
}) {
  const baseUrl = (process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE || "15m",
        format,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        options: {
          temperature,
          top_p: 0.9,
          num_predict: 1200,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama returned ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as OllamaChatResponse;
    const content = data.message?.content?.trim();

    if (!content) {
      throw new Error("Ollama returned an empty response.");
    }

    return content;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        error.name === "AbortError" ||
        error.message.toLowerCase().includes("timed out"))
    ) {
      throw new Error(
        `Ollama timed out after ${Math.round(timeoutMs / 1000)} seconds. The model may be busy or still loading. Try again once; if it repeats, restart Ollama.`
      );
    }

    if (
      error instanceof TypeError ||
      (error instanceof Error && error.message.toLowerCase().includes("fetch failed"))
    ) {
      throw new Error(
        "Cannot connect to Ollama. Make sure Ollama is running locally, then try again."
      );
    }

    throw error;
  }
}
