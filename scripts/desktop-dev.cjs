const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

function parseEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

const env = { ...process.env, ...parseEnv(envPath) };
const ollamaUrl = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const model = env.OLLAMA_MODEL || "gemma3:4b";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

let ollama = null;
let next = null;
let electron = null;

async function ready(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.ok || r.status < 500;
  } catch {
    return false;
  }
}

async function wait(url, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await ready(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function run(command, args, options = {}) {
  return spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    ...options,
  });
}

function stop() {
  for (const child of [electron, next, ollama]) {
    if (child && !child.killed) {
      try {
        child.kill();
      } catch {}
    }
  }
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

(async () => {
  console.log("\nPost Studio Desktop\n");

  if (!(await ready(`${ollamaUrl}/api/tags`))) {
    console.log("Starting Ollama...");
    ollama = run("ollama", ["serve"], {
      stdio: ["ignore", "ignore", "inherit"],
    });

    if (!(await wait(`${ollamaUrl}/api/tags`, 20000))) {
      throw new Error("Ollama could not start. Install Ollama first.");
    }
  }

  const tagsResponse = await fetch(`${ollamaUrl}/api/tags`);
  const tags = await tagsResponse.json();
  const installed = Array.isArray(tags.models)
    ? tags.models.some((item) => String(item?.name || "") === model)
    : false;

  if (!installed) {
    console.log(`Downloading missing model: ${model}`);
    await new Promise((resolve, reject) => {
      const pull = run("ollama", ["pull", model]);
      pull.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("Model download failed."))));
      pull.on("error", reject);
    });
  }

  console.log("Starting Next.js...");
  next = run(npmCmd, ["run", "dev"], {
    stdio: ["ignore", "inherit", "inherit"],
  });

  if (!(await wait("http://127.0.0.1:3000", 60000))) {
    throw new Error("Next.js did not start on port 3000.");
  }

  console.log("Opening desktop window...");
  electron = run(npxCmd, ["electron", "desktop/main.cjs", "--dev"]);

  electron.on("exit", () => {
    stop();
    process.exit(0);
  });
})().catch((error) => {
  console.error(error);
  stop();
  process.exit(1);
});
