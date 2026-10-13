const fs = require("fs");
const path = require("path");

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

    result[key] = value;
  }

  return result;
}

(async () => {
  const envPath = path.join(process.cwd(), ".env.local");
  const localEnv = parseEnv(envPath);
  const token = localEnv.LINKEDIN_ACCESS_TOKEN || process.env.LINKEDIN_ACCESS_TOKEN || "";

  if (!token) {
    console.error("");
    console.error("LinkedIn is not configured.");
    console.error("Add LINKEDIN_ACCESS_TOKEN to .env.local first.");
    console.error("");
    process.exit(1);
  }

  console.log("Checking LinkedIn access token...");
  console.log("Token loaded from local configuration. It will not be printed.");

  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const raw = await response.text();
  let data = {};

  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {}

  if (response.status === 401) {
    console.error("");
    console.error("LinkedIn token is invalid or expired. ✗");
    console.error("Generate a fresh member access token and replace LINKEDIN_ACCESS_TOKEN in .env.local.");
    console.error("");
    process.exit(1);
  }

  if (!response.ok) {
    console.error("");
    console.error(`LinkedIn check failed with HTTP ${response.status}.`);
    console.error(data?.message || data?.detail || raw || "Unknown error");
    console.error("");
    process.exit(1);
  }

  console.log("");
  console.log("LinkedIn token is valid. ✓");
  if (data?.name) console.log(`Signed in as: ${data.name}`);
  console.log("");
})().catch((error) => {
  console.error("");
  console.error("LinkedIn check failed.");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("");
  process.exit(1);
});
