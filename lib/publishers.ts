export type PublishResult = {
  platform: "linkedin" | "x";
  success: boolean;
  id?: string;
  imageAttached?: boolean;
  error?: string;
};

type LinkedInImage = {
  dataUrl: string;
  altText?: string;
};

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function safeErrorDetail(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return (
      parsed?.message ||
      parsed?.detail ||
      parsed?.title ||
      parsed?.error_description ||
      raw
    );
  } catch {
    return raw;
  }
}

async function resolveLinkedInAuthor(accessToken: string) {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const raw = await response.text();

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "LinkedIn access token is invalid or expired. Generate a fresh member access token and replace LINKEDIN_ACCESS_TOKEN in your local .env.local."
      );
    }

    throw new Error(
      `LinkedIn userinfo returned ${response.status}: ${safeErrorDetail(raw)}`
    );
  }

  const data = raw ? JSON.parse(raw) : {};
  const subject = String(data?.sub || "").trim();

  if (!subject) {
    throw new Error(
      "LinkedIn userinfo did not return a member identifier (sub)."
    );
  }

  return `urn:li:person:${subject}`;
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg|gif));base64,([A-Za-z0-9+/=\s]+)$/i
  );

  if (!match) {
    throw new Error(
      "The selected image is not a supported PNG, JPG, JPEG, or GIF data image."
    );
  }

  const mimeType =
    match[1].toLowerCase() === "image/jpg"
      ? "image/jpeg"
      : match[1].toLowerCase();

  return {
    mimeType,
    bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64"),
  };
}

async function uploadLinkedInImage({
  accessToken,
  version,
  owner,
  image,
}: {
  accessToken: string;
  version: string;
  owner: string;
  image: LinkedInImage;
}) {
  const initialized = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Linkedin-Version": version,
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner,
        },
      }),
    }
  );

  const initializeRaw = await initialized.text();

  if (!initialized.ok) {
    throw new Error(
      `LinkedIn image initialization returned ${initialized.status}: ${safeErrorDetail(
        initializeRaw
      )}`
    );
  }

  const initializeData = initializeRaw ? JSON.parse(initializeRaw) : {};
  const uploadUrl = String(initializeData?.value?.uploadUrl || "");
  const imageUrn = String(initializeData?.value?.image || "");

  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn did not return an image upload URL.");
  }

  const { mimeType, bytes } = decodeDataUrl(image.dataUrl);

  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(bytes),
  });

  if (!uploaded.ok) {
    const detail = await uploaded.text();
    throw new Error(
      `LinkedIn image upload returned ${uploaded.status}: ${safeErrorDetail(
        detail
      )}`
    );
  }

  return imageUrn;
}

export function getPublishingConfig() {
  return {
    linkedinConfigured: Boolean(env("LINKEDIN_ACCESS_TOKEN")),
    xMode: "web-composer",
  };
}

export async function publishLinkedIn(
  text: string,
  image?: LinkedInImage | null
): Promise<PublishResult> {
  const accessToken = env("LINKEDIN_ACCESS_TOKEN");
  const version = env("LINKEDIN_VERSION") || "202609";

  if (!accessToken) {
    return {
      platform: "linkedin",
      success: false,
      error:
        "LinkedIn is not configured. Add LINKEDIN_ACCESS_TOKEN to .env.local.",
    };
  }

  try {
    const author = await resolveLinkedInAuthor(accessToken);

    let mediaContent:
      | {
          media: {
            id: string;
            altText: string;
          };
        }
      | undefined;

    if (image?.dataUrl) {
      const imageUrn = await uploadLinkedInImage({
        accessToken,
        version,
        owner: author,
        image,
      });

      mediaContent = {
        media: {
          id: imageUrn,
          altText:
            image.altText?.trim().slice(0, 120) ||
            "Visual accompanying this Data With Anurag post",
        },
      };
    }

    const response = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "Linkedin-Version": version,
      },
      body: JSON.stringify({
        author,
        commentary: text,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(mediaContent ? { content: mediaContent } : {}),
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });

    if (!response.ok) {
      const detail = safeErrorDetail(await response.text());

      if (response.status === 401) {
        return {
          platform: "linkedin",
          success: false,
          error:
            "LinkedIn access token is invalid or expired. Generate a fresh member access token and update your local .env.local.",
        };
      }

      return {
        platform: "linkedin",
        success: false,
        error: `LinkedIn returned ${response.status}: ${detail}`,
      };
    }

    return {
      platform: "linkedin",
      success: true,
      id: response.headers.get("x-restli-id") || undefined,
      imageAttached: Boolean(mediaContent),
    };
  } catch (error) {
    return {
      platform: "linkedin",
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown LinkedIn publishing error.",
    };
  }
}

