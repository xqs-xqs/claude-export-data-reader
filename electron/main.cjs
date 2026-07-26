const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell
} = require("electron");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { mergeByKey, parseArchive } = require("./archive.cjs");

const DEVELOPMENT_ORIGIN = "http://127.0.0.1:5173";
const RENDERER_FILE_PATH = path.join(__dirname, "..", "dist", "index.html");
const EMPTY_LIBRARY = {
  version: 1,
  imports: [],
  accounts: [],
  conversations: [],
  projects: [],
  memories: []
};

let mainWindow;
let libraryCache;
let activeDevelopmentOrigin;
let rendererSessionConfigured = false;

function dataFilePath() {
  return path.join(app.getPath("userData"), "reader-data.json");
}

function normalizeLibrary(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...EMPTY_LIBRARY,
    ...source,
    imports: Array.isArray(source.imports) ? source.imports : [],
    accounts: Array.isArray(source.accounts) ? source.accounts : [],
    conversations: Array.isArray(source.conversations)
      ? source.conversations
      : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
    memories: Array.isArray(source.memories) ? source.memories : []
  };
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
      if (
        !app.isPackaged &&
        activeDevelopmentOrigin &&
        new URL(details.url).origin === activeDevelopmentOrigin
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
  activeDevelopmentOrigin = developmentUrl
    ? new URL(developmentUrl).origin
    : undefined;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f7f6f2",
    title: "Claude 导出数据阅读器",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);

  configureRendererSession(mainWindow.webContents.session);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  const guardNavigation = (event, url) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  };
  mainWindow.webContents.on("will-navigate", guardNavigation);
  mainWindow.webContents.on("will-redirect", guardNavigation);
  mainWindow.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });

  if (developmentUrl) {
    mainWindow.loadURL(developmentUrl);
  } else {
    mainWindow.loadFile(RENDERER_FILE_PATH);
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  handleTrusted("archive:import", importArchive);
  handleTrusted("library:get", loadLibrary);
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
