const { app, BrowserWindow, dialog, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const isDev = process.argv.includes("--dev");
const repoRoot = path.resolve(__dirname, "..");

let mainWindow = null;
let appUrl = null;
let nextProcess = null;
let ollamaProcess = null;

function withDesktopPath(env) {
  const additions =
    process.platform === "win32"
      ? [
          env.LOCALAPPDATA
            ? path.join(env.LOCALAPPDATA, "Programs", "Ollama")
            : "",
          env.ProgramFiles
            ? path.join(env.ProgramFiles, "Ollama")
            : "",
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];

  return {
    ...env,
    PATH: [...additions, env.PATH || ""]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const result = {};

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

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

function desktopEnvPath() {
  return isDev
    ? path.join(repoRoot, ".env.local")
    : path.join(app.getPath("userData"), ".env.local");
}

function ensurePackagedEnvFile() {
  if (isDev) return;

  const target = desktopEnvPath();
  if (fs.existsSync(target)) return;

  const example = path.join(process.resourcesPath, ".env.example");

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (fs.existsSync(example)) {
      fs.copyFileSync(example, target);
      fs.chmodSync(target, 0o600);
    }
  } catch (error) {
    console.error("Could not initialize desktop environment file:", error);
  }
}

function getRuntimeEnv() {
  ensurePackagedEnvFile();

  return withDesktopPath({
    ...process.env,
    ...parseEnvFile(desktopEnvPath()),
  });
}

async function isUrlReady(url) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 60000) {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await isUrlReady(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3417;

      server.close(() => resolve(port));
    });
  });
}

function logsDir() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logPath(name) {
  return path.join(logsDir(), name);
}

function logStream(name) {
  return fs.openSync(logPath(name), "a");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusHtml(title, message, error = false) {
  const accent = error ? "#ff6b6b" : "#f6c915";
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return `data:text/html;charset=UTF-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="dark" />
    <title>Post Studio</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 10%, rgba(246,201,21,.08), transparent 30%),
          #070707;
        color: #f5f5f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        width: min(560px, calc(100vw - 48px));
        padding: 34px;
        border: 1px solid #292929;
        border-radius: 20px;
        background: #0d0d0d;
        box-shadow: 0 24px 80px rgba(0,0,0,.45);
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 26px;
        color: #f6c915;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .12em;
        text-transform: uppercase;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: ${accent};
        box-shadow: 0 0 18px ${accent};
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
        line-height: 1.15;
      }
      p {
        margin: 0;
        color: #aaa;
        font-size: 14px;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .bar {
        height: 3px;
        margin-top: 28px;
        overflow: hidden;
        border-radius: 999px;
        background: #1d1d1d;
      }
      .bar::after {
        content: "";
        display: block;
        width: 38%;
        height: 100%;
        background: ${accent};
        animation: move 1.1s ease-in-out infinite alternate;
      }
      .error .bar::after { animation: none; width: 100%; }
      .hint {
        margin-top: 18px;
        color: #686868;
        font-size: 11px;
      }
      @keyframes move {
        from { transform: translateX(-10%); }
        to { transform: translateX(190%); }
      }
    </style>
  </head>
  <body>
    <div class="card ${error ? "error" : ""}">
      <div class="brand"><span class="dot"></span> Data With Anurag · Post Studio</div>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <div class="bar"></div>
      ${error ? `<div class="hint">Use Post Studio → Open Logs Folder for diagnostics.</div>` : ""}
    </div>
  </body>
</html>
`)}`;
}

async function showStatus(title, message, error = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadURL(statusHtml(title, message, error));
}

async function ensureOllama(env) {
  const baseUrl = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    ""
  );

  if (await isUrlReady(`${baseUrl}/api/tags`)) {
    return;
  }

  const log = logStream("ollama.log");

  ollamaProcess = spawn("ollama", ["serve"], {
    env,
    stdio: ["ignore", log, log],
  });

  ollamaProcess.on("error", (error) => {
    console.error("Ollama process error:", error);
  });

  const ready = await waitForUrl(`${baseUrl}/api/tags`, 20000);

  if (!ready) {
    throw new Error(
      "Ollama could not be started. Run the one-time local setup from the repository first."
    );
  }
}

async function ensureConfiguredModel(env) {
  const baseUrl = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
    /\/$/,
    ""
  );
  const model = env.OLLAMA_MODEL || "gemma3:4b";

  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const data = await response.json();
    const names = Array.isArray(data.models)
      ? data.models.map((item) => String(item?.name || ""))
      : [];

    if (!names.some((name) => name === model || name.startsWith(`${model}:`))) {
      throw new Error(
        `The Ollama model "${model}" is not installed. Run the one-time setup or "ollama pull ${model}" first.`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("not installed")) {
      throw error;
    }

    throw new Error("Post Studio could not verify the configured Ollama model.");
  }
}

async function startPackagedNextServer(env) {
  const runtimeDir = path.join(process.resourcesPath, "app-runtime");
  const serverPath = path.join(runtimeDir, "server.js");

  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `The packaged Next.js runtime is missing at: ${serverPath}`
    );
  }

  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const nextLogPath = logPath("next.log");
  const log = fs.openSync(nextLogPath, "a");

  const packagedNodeModules = path.join(app.getAppPath(), "node_modules");
  const nodePath = [packagedNodeModules, env.NODE_PATH || ""]
    .filter(Boolean)
    .join(path.delimiter);

  nextProcess = spawn(process.execPath, [serverPath], {
    cwd: runtimeDir,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_PATH: nodePath,
    },
    stdio: ["ignore", log, log],
  });

  let spawnError = null;

  nextProcess.on("error", (error) => {
    spawnError = error;
    console.error("Next.js server process error:", error);
  });

  const started = Date.now();

  while (Date.now() - started < 60000) {
    if (spawnError) {
      throw new Error(
        `The embedded Post Studio server could not start: ${spawnError.message}`
      );
    }

    if (await isUrlReady(url)) {
      return url;
    }

    if (nextProcess.exitCode !== null) {
      let tail = "";

      try {
        const raw = fs.readFileSync(nextLogPath, "utf8");
        tail = raw.split(/\r?\n/).slice(-12).join("\n").trim();
      } catch {}

      throw new Error(
        `The embedded Post Studio server exited with code ${nextProcess.exitCode}.${
          tail ? `\n\n${tail}` : ""
        }`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    `The Post Studio local server did not become ready within 60 seconds. Logs: ${nextLogPath}`
  );
}

function installApplicationMenu() {
  const configFolder = isDev ? repoRoot : app.getPath("userData");

  const template = [
    {
      label: "Post Studio",
      submenu: [
        {
          label: "Open Local Config Folder",
          click: () => {
            void shell.openPath(configFolder);
          },
        },
        {
          label: "Open Logs Folder",
          click: () => {
            const logs = path.join(app.getPath("userData"), "logs");
            fs.mkdirSync(logs, { recursive: true });
            void shell.openPath(logs);
          },
        },
        { type: "separator" },
        process.platform === "darwin"
          ? { role: "quit" }
          : { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: "#080808",
    title: "Post Studio",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (/^https?:\/\//i.test(targetUrl)) {
      void shell.openExternal(targetUrl);
    }

    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!/^https?:\/\//i.test(targetUrl)) return;

    const targetOrigin = new URL(targetUrl).origin;
    const appOrigin = appUrl ? new URL(appUrl).origin : "";

    if (!appOrigin || targetOrigin !== appOrigin) {
      event.preventDefault();
      void shell.openExternal(targetUrl);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void showStatus(
    "Starting Post Studio",
    "Preparing your local AI workspace…"
  );
}

function stopChildProcesses() {
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill("SIGTERM");
  }

  if (ollamaProcess && !ollamaProcess.killed) {
    ollamaProcess.kill("SIGTERM");
  }

  nextProcess = null;
  ollamaProcess = null;
}

app.whenReady().then(async () => {
  app.setAppUserModelId("com.datawithanurag.poststudio");
  installApplicationMenu();
  createWindow();

  try {
    let url;

    if (isDev) {
      await showStatus(
        "Connecting to development server",
        "Waiting for http://127.0.0.1:3000…"
      );

      url = process.env.POST_STUDIO_DEV_URL || "http://127.0.0.1:3000";

      const ready = await waitForUrl(url, 60000);
      if (!ready) {
        throw new Error(
          "The development server is not ready. Start with npm run desktop."
        );
      }
    } else {
      const env = getRuntimeEnv();

      await showStatus(
        "Starting local AI",
        "Checking Ollama on this computer…"
      );
      await ensureOllama(env);

      await showStatus(
        "Checking AI model",
        `Verifying ${env.OLLAMA_MODEL || "gemma3:4b"}…`
      );
      await ensureConfiguredModel(env);

      await showStatus(
        "Starting Post Studio",
        "Launching the embedded application server…"
      );
      url = await startPackagedNextServer(env);
    }

    appUrl = url;
    await mainWindow.loadURL(url);
    mainWindow.show();
    mainWindow.focus();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Post Studio could not start.";

    console.error(error);

    await showStatus("Post Studio could not start", message, true);

    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Post Studio could not start",
      message,
      detail: isDev
        ? "Check the terminal output."
        : `Desktop config: ${desktopEnvPath()}\nLogs: ${logsDir()}`,
      buttons: ["OK", "Open Logs Folder"],
      defaultId: 0,
      cancelId: 0,
    }).then((result) => {
      if (result.response === 1) {
        void shell.openPath(logsDir());
      }
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();

      if (appUrl) {
        void mainWindow.loadURL(appUrl);
      }
    }
  });
});

app.on("before-quit", () => {
  stopChildProcesses();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
