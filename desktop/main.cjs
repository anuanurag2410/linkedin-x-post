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

function logStream(name) {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });

  return fs.openSync(path.join(logDir, name), "a");
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
      "The packaged Next.js runtime is missing. Rebuild the desktop app."
    );
  }

  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}`;
  const log = logStream("next.log");

  nextProcess = spawn(process.execPath, [serverPath], {
    cwd: runtimeDir,
    env: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    stdio: ["ignore", log, log],
  });

  nextProcess.on("error", (error) => {
    console.error("Next.js server process error:", error);
  });

  const ready = await waitForUrl(url, 60000);

  if (!ready) {
    throw new Error(
      "The Post Studio local server did not start. Check the desktop logs folder."
    );
  }

  return url;
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

function createWindow(url) {
  appUrl = url;

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
    const current = mainWindow?.webContents.getURL() || "";

    if (targetUrl !== current && /^https?:\/\//i.test(targetUrl)) {
      const currentOrigin = new URL(current).origin;
      const targetOrigin = new URL(targetUrl).origin;

      if (currentOrigin !== targetOrigin) {
        event.preventDefault();
        void shell.openExternal(targetUrl);
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(url);
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

  try {
    let url;

    if (isDev) {
      url = process.env.POST_STUDIO_DEV_URL || "http://127.0.0.1:3000";

      const ready = await waitForUrl(url, 60000);
      if (!ready) {
        throw new Error(
          "The development server is not ready. Start with npm run desktop."
        );
      }
    } else {
      const env = getRuntimeEnv();
      await ensureOllama(env);
      await ensureConfiguredModel(env);
      url = await startPackagedNextServer(env);
    }

    createWindow(url);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Post Studio could not start.";

    console.error(error);

    await dialog.showMessageBox({
      type: "error",
      title: "Post Studio could not start",
      message,
      detail: isDev
        ? "Check the terminal output."
        : `Desktop config: ${desktopEnvPath()}\nLogs: ${path.join(
            app.getPath("userData"),
            "logs"
          )}`,
    });

    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
      createWindow(appUrl);
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
