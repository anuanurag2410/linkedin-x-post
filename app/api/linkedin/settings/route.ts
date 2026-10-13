import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "fs";
import path from "path";
import { getLinkedInConnectionStatus } from "@/lib/publishers";

export const runtime = "nodejs";

function envFilePath() {
  const desktopPath = process.env.POST_STUDIO_ENV_FILE?.trim();
  if (desktopPath) return desktopPath;
  return path.join(process.cwd(), ".env.local");
}

function parseEnv(text: string) {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function writeEnvValue(filePath: string, key: string, value: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });

  const original = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = original ? original.split(/\r?\n/) : [];
  let replaced = false;

  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const index = line.indexOf("=");
    if (index <= 0) return line;

    const currentKey = line.slice(0, index).trim();
    if (currentKey !== key) return line;

    replaced = true;
    return `${key}=${value}`;
  });

  if (!replaced) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${value}`);
  }

  const output = next.join("\n").replace(/\n*$/, "\n");
  writeFileSync(filePath, output, "utf8");

  try {
    chmodSync(filePath, 0o600);
  } catch {}
}

export async function GET() {
  const filePath = envFilePath();
  const raw = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const values = parseEnv(raw);
  const token = String(values.LINKEDIN_ACCESS_TOKEN || "").trim();

  return NextResponse.json(
    {
      configured: Boolean(token),
      tokenPreview: token
        ? `${token.slice(0, 4)}••••••${token.slice(-4)}`
        : "",
      source: process.env.POST_STUDIO_ENV_FILE ? "desktop" : "development",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = String(body?.token || "").trim();

    if (!token) {
      return NextResponse.json(
        { error: "Paste a LinkedIn member access token first." },
        { status: 400 }
      );
    }

    if (/^WPL_API/i.test(token)) {
      return NextResponse.json(
        {
          error:
            "This looks like a LinkedIn Client Secret, not a member access token. Use the OAuth Token Generator token.",
        },
        { status: 400 }
      );
    }

    const filePath = envFilePath();
    writeEnvValue(filePath, "LINKEDIN_ACCESS_TOKEN", token);
    writeEnvValue(filePath, "LINKEDIN_VERSION", "202609");

    const status = await getLinkedInConnectionStatus();

    if (!status.connected) {
      return NextResponse.json(
        {
          error:
            status.error ||
            "The token was saved, but LinkedIn did not accept it.",
          status,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        saved: true,
        status,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("LinkedIn settings save failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save LinkedIn settings.",
      },
      { status: 500 }
    );
  }
}
