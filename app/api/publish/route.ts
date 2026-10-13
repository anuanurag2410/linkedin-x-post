import { NextResponse } from "next/server";
import {
  getPublishingConfig,
  publishLinkedIn,
  type PublishResult,
} from "@/lib/publishers";
import { formatSocialText } from "@/lib/social-format";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getPublishingConfig());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const target = String(body?.target || "");
    const linkedinText = formatSocialText(
      String(body?.linkedinText || ""),
      "linkedin"
    );
    const approvals = body?.approvals || {};
    const imageDataUrl =
      typeof body?.imageDataUrl === "string" &&
      body.imageDataUrl.startsWith("data:image/")
        ? body.imageDataUrl
        : "";
    const imageAltText = String(body?.imageAltText || "").trim();

    if (target !== "linkedin") {
      return NextResponse.json(
        {
          error:
            "Only LinkedIn is published through the API. X uses the free web composer flow.",
        },
        { status: 400 }
      );
    }

    if (!approvals.linkedin || !linkedinText) {
      return NextResponse.json(
        { error: "Approve the LinkedIn draft before publishing it." },
        { status: 400 }
      );
    }

    const results: PublishResult[] = [
      await publishLinkedIn(
        linkedinText,
        imageDataUrl
          ? {
              dataUrl: imageDataUrl,
              altText: imageAltText,
            }
          : null
      ),
    ];

    const failed = results.filter((item) => !item.success);

    if (failed.length > 0) {
      return NextResponse.json(
        {
          error:
            failed[0]?.error ||
            "LinkedIn publishing failed for an unknown reason.",
          allSucceeded: false,
          partialSuccess: false,
          results,
          warning: null,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      allSucceeded: true,
      partialSuccess: false,
      results,
      warning: null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Publishing failed.",
      },
      { status: 500 }
    );
  }
}
