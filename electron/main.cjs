const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  screen,
  shell
} = require("electron");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync
} = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const {
  mergeByKey,
  normalizeStoredLibrary,
  parseArchive
} = require("./archive.cjs");

const DEVELOPMENT_ORIGIN = "http://127.0.0.1:5173";
const RENDERER_FILE_PATH = path.join(__dirname, "..", "dist", "index.html");
const EMPTY_LIBRARY = {
  version: 1,
  imports: [],
  accounts: [],
  conversations: [],
  projects: [],
  memories: [],
  pinned_conversations: []
};

let mainWindow;
let libraryCache;
let activeDevelopmentOrigin;
let rendererSessionConfigured = false;
let windowStateSaveTimer;

function dataFilePath() {
  return path.join(app.getPath("userData"), "reader-data.json");
}

function windowStateFilePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function clampWindowBounds(bounds) {
  if (
    !bounds ||
    !Number.isSafeInteger(bounds.x) ||
    !Number.isSafeInteger(bounds.y) ||
    !Number.isSafeInteger(bounds.width) ||
    !Number.isSafeInteger(bounds.height) ||
    bounds.width < 320 ||
    bounds.height < 240 ||
    bounds.width > 16384 ||
    bounds.height > 16384
  ) {
    return undefined;
  }
  const displays = screen.getAllDisplays();
  const display = displays.reduce((best, candidate) => {
    const area = candidate.workArea;
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, area.x + area.width) -
        Math.max(bounds.x, area.x)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, area.y + area.height) -
        Math.max(bounds.y, area.y)
    );
    const overlap = overlapWidth * overlapHeight;
    return overlap > best.overlap ? { display: candidate, overlap } : best;
  }, { display: screen.getPrimaryDisplay(), overlap: 0 }).display;
  const area = display.workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  };
}

function loadWindowState() {
  try {
    const parsed = JSON.parse(readFileSync(windowStateFilePath(), "utf8"));
    const bounds = clampWindowBounds(parsed?.bounds);
    return {
      bounds,
      maximized: parsed.maximized === true
    };
  } catch {
    return {};
  }
}

function defaultWindowBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1440, area.width);
  const height = Math.min(920, area.height);
  return {
    width,
    height,
    x: area.x + Math.max(0, Math.floor((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - height) / 2))
  };
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  try {
    const state = {
      bounds: window.getNormalBounds(),
      maximized: window.isMaximized()
    };
    mkdirSync(path.dirname(windowStateFilePath()), { recursive: true });
    const temporaryPath = `${windowStateFilePath()}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(state), {
      encoding: "utf8",
      mode: 0o600
    });
    renameSync(temporaryPath, windowStateFilePath());
  } catch {
    try {
      rmSync(`${windowStateFilePath()}.${process.pid}.tmp`, { force: true });
    } catch {}
    // Window restoration is best effort and must never prevent the app closing.
  }
}

function scheduleWindowStateSave(window) {
  clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => saveWindowState(window), 250);
}

function normalizeLibrary(value) {
  return normalizeStoredLibrary(value);
}

async function loadLibrary() {
  if (libraryCache) return libraryCache;
  try {
    libraryCache = normalizeLibrary(
      JSON.parse(await readFile(dataFilePath(), "utf8"))
    );
  } catch {
    libraryCache = structuredClone(EMPTY_LIBRARY);
  }
  return libraryCache;
}

async function saveLibrary(library) {
  await mkdir(path.dirname(dataFilePath()), { recursive: true });
  const temporaryPath = `${dataFilePath()}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(library), {
    encoding: "utf8",
    mode: 0o600
  });
  const { rename } = require("node:fs/promises");
  await rename(temporaryPath, dataFilePath());
  libraryCache = library;
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    if (
      !app.isPackaged &&
      activeDevelopmentOrigin &&
      url.origin === activeDevelopmentOrigin &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      return true;
    }

    if (url.protocol !== "file:") return false;
    url.hash = "";
    url.search = "";
    return path.resolve(fileURLToPath(url)) === path.resolve(RENDERER_FILE_PATH);
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame?.url)
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }
}

function handleTrusted(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return handler(...args);
  });
}

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    void shell.openExternal(url.href).catch(() => {});
  } catch {
    // Ignore malformed or unsupported links from imported content.
  }
}

function configureRendererSession(electronSession) {
  if (rendererSessionConfigured) return;
  rendererSessionConfigured = true;

  electronSession.setPermissionCheckHandler(() => false);
  electronSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );
  electronSession.webRequest.onBeforeRequest(
    {
      urls: [
        "http://*/*",
        "https://*/*",
        "ws://*/*",
        "wss://*/*"
      ]
    },
    (details, callback) => {
      const requestUrl = new URL(details.url);
      const developmentWebSocket =
        requestUrl.protocol === "ws:" &&
        requestUrl.hostname === "127.0.0.1" &&
        requestUrl.port === "5173";
      if (
        !app.isPackaged &&
        activeDevelopmentOrigin &&
        (requestUrl.origin === activeDevelopmentOrigin ||
          developmentWebSocket)
      ) {
        callback({ cancel: false });
        return;
      }
      callback({ cancel: true });
    }
  );
}

function developmentServerUrl() {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return undefined;

  const url = new URL(process.env.VITE_DEV_SERVER_URL);
  if (
    url.origin !== DEVELOPMENT_ORIGIN ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      `VITE_DEV_SERVER_URL must use the local development origin ${DEVELOPMENT_ORIGIN}.`
    );
  }
  return DEVELOPMENT_ORIGIN;
}

async function importArchive() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Claude Export ZIP",
    properties: ["openFile"],
    filters: [{ name: "ZIP archive", extensions: ["zip"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const parsed = await parseArchive(result.filePaths[0]);
  const library = await loadLibrary();
  const duplicate = library.imports.some(
    (item) => item.sha256 === parsed.sha256
  );
  const existingImport = library.imports.find(
    (item) => item.sha256 === parsed.sha256
  );
  const incomingMemories = parsed.memories.map((memory) => ({
    ...memory,
    imported_at: existingImport?.imported_at || memory.imported_at
  }));

  const nextLibrary = {
    ...library,
    imports: duplicate
      ? library.imports
      : [
          ...library.imports,
          {
            sha256: parsed.sha256,
            filename: parsed.filename,
            imported_at: parsed.importedAt,
            conversation_count: parsed.conversations.length
          }
        ],
    accounts: mergeByKey(library.accounts, parsed.accounts, (item) => item.uuid),
    conversations: mergeByKey(
      library.conversations,
      parsed.conversations,
      (item) => `${item.account_uuid}:${item.uuid}`
    ),
    projects: mergeByKey(
      library.projects,
      parsed.projects,
      (item) => `${item.account_uuid}:${item.uuid}`
    ),
    memories: mergeByKey(
      library.memories,
      incomingMemories,
      (item) => `${item.source_sha256 || "legacy"}:${item.account_uuid}`
    )
  };

  await saveLibrary(nextLibrary);
  return {
    canceled: false,
    duplicate,
    filename: parsed.filename,
    importedConversations: parsed.conversations.length,
    importedMemories: parsed.memories.length,
    library: nextLibrary
  };
}

function createWindow() {
  const developmentUrl = developmentServerUrl();
  const savedWindowState = loadWindowState();
  const initialBounds = savedWindowState.bounds || defaultWindowBounds();
  activeDevelopmentOrigin = developmentUrl
    ? new URL(developmentUrl).origin
    : undefined;

  const window = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    minWidth: Math.min(980, initialBounds.width),
    minHeight: Math.min(680, initialBounds.height),
    backgroundColor: "#fcfcfb",
    title: "Claude 导出数据阅读器",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => {
    if (savedWindowState.maximized) window.maximize();
    window.show();
  });
  window.on("resize", () => scheduleWindowStateSave(window));
  window.on("move", () => scheduleWindowStateSave(window));
  window.on("maximize", () => scheduleWindowStateSave(window));
  window.on("unmaximize", () => scheduleWindowStateSave(window));
  window.on("close", () => {
    clearTimeout(windowStateSaveTimer);
    saveWindowState(window);
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  configureRendererSession(window.webContents.session);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  if (developmentUrl) {
    window.loadURL(developmentUrl);
  } else {
    window.loadFile(RENDERER_FILE_PATH);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  handleTrusted("archive:import", importArchive);
  handleTrusted("library:get", loadLibrary);
  handleTrusted("conversation:set-pinned", async (conversationKey, pinned) => {
    if (
      typeof conversationKey !== "string" ||
      !conversationKey ||
      conversationKey.length > 8192
    ) {
      throw new TypeError("Conversation key must be non-empty text.");
    }
    if (typeof pinned !== "boolean") {
      throw new TypeError("Pinned state must be a boolean.");
    }

    const library = await loadLibrary();
    const conversationExists = library.conversations.some(
      (conversation) =>
        `${conversation.account_uuid}:${conversation.uuid}` === conversationKey
    );
    if (!conversationExists) {
      throw new Error("Cannot pin a conversation that is not in the library.");
    }

    const existing = library.pinned_conversations.filter(
      (item) => item.conversation_key !== conversationKey
    );
    const nextLibrary = {
      ...library,
      pinned_conversations: pinned
        ? [
            {
              conversation_key: conversationKey,
              pinned_at: new Date().toISOString()
            },
            ...existing
          ]
        : existing
    };
    await saveLibrary(nextLibrary);
    return nextLibrary;
  });
  handleTrusted("clipboard:write-text", (text) => {
    if (typeof text !== "string") {
      throw new TypeError("Clipboard content must be text.");
    }
    clipboard.writeText(text);
    return true;
  });
  handleTrusted("library:clear", async () => {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["取消", "清除本地导入数据"],
      defaultId: 0,
      cancelId: 0,
      title: "清除本地数据",
      message: "这不会删除原始 ZIP，但会清除阅读器中的已导入数据。"
    });
    if (answer.response !== 1) return { canceled: true };
    await saveLibrary(structuredClone(EMPTY_LIBRARY));
    return { canceled: false, library: libraryCache };
  });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
