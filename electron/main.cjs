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
const { readFile, writeFile, mkdir, rename } = require("node:fs/promises");
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
  parseArchive,
  parseSplitArchiveBatch
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
const EMPTY_HIDDEN_ITEMS = {
  version: 1,
  conversationKeys: [],
  questionIdsByConversation: {}
};
const MAX_HIDDEN_CONVERSATIONS = 100_000;
const MAX_HIDDEN_QUESTIONS = 2_000_000;

let mainWindow;
let libraryCache;
let hiddenItemsCache;
let hiddenItemsMutationQueue = Promise.resolve();
let activeDevelopmentOrigin;
let rendererSessionConfigured = false;
let windowStateSaveTimer;

function dataFilePath() {
  return path.join(app.getPath("userData"), "reader-data.json");
}

function hiddenItemsFilePath() {
  return path.join(app.getPath("userData"), "reader-hidden-items.json");
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
  await rename(temporaryPath, dataFilePath());
  libraryCache = library;
}

function persistedIdentifier(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 8192
    ? value
    : undefined;
}

function hiddenConversationKey(accountUuid, conversationUuid) {
  return JSON.stringify([accountUuid, conversationUuid]);
}

function normalizeHiddenConversationKey(value) {
  if (typeof value !== "string") return undefined;
  try {
    const tuple = JSON.parse(value);
    if (!Array.isArray(tuple) || tuple.length !== 2) return undefined;
    const accountUuid = persistedIdentifier(tuple[0]);
    const conversationUuid = persistedIdentifier(tuple[1]);
    return accountUuid && conversationUuid
      ? hiddenConversationKey(accountUuid, conversationUuid)
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeHiddenItems(value) {
  if (!value || typeof value !== "object" || value.version !== 1) {
    return structuredClone(EMPTY_HIDDEN_ITEMS);
  }

  const conversationKeys = Array.from(
    new Set(
      (Array.isArray(value.conversationKeys) ? value.conversationKeys : [])
        .map(normalizeHiddenConversationKey)
        .filter(Boolean)
    )
  ).slice(0, MAX_HIDDEN_CONVERSATIONS);
  const questionIdsByConversation = {};
  let questionCount = 0;
  let questionConversationCount = 0;
  const questionEntries =
    value.questionIdsByConversation &&
    typeof value.questionIdsByConversation === "object" &&
    !Array.isArray(value.questionIdsByConversation)
      ? Object.entries(value.questionIdsByConversation)
      : [];

  for (const [rawKey, rawQuestionIds] of questionEntries) {
    if (questionConversationCount >= MAX_HIDDEN_CONVERSATIONS) {
      break;
    }
    const conversationKey = normalizeHiddenConversationKey(rawKey);
    if (!conversationKey || !Array.isArray(rawQuestionIds)) continue;
    const questionIds = Array.from(
      new Set(rawQuestionIds.map(persistedIdentifier).filter(Boolean))
    ).slice(0, MAX_HIDDEN_QUESTIONS - questionCount);
    if (!questionIds.length) continue;
    questionIdsByConversation[conversationKey] = questionIds;
    questionConversationCount += 1;
    questionCount += questionIds.length;
    if (questionCount >= MAX_HIDDEN_QUESTIONS) break;
  }

  return {
    version: 1,
    conversationKeys,
    questionIdsByConversation
  };
}

async function loadHiddenItems() {
  if (hiddenItemsCache) return hiddenItemsCache;
  try {
    hiddenItemsCache = normalizeHiddenItems(
      JSON.parse(await readFile(hiddenItemsFilePath(), "utf8"))
    );
  } catch {
    hiddenItemsCache = structuredClone(EMPTY_HIDDEN_ITEMS);
  }
  return hiddenItemsCache;
}

async function saveHiddenItems(hiddenItems) {
  const normalized = normalizeHiddenItems(hiddenItems);
  await mkdir(path.dirname(hiddenItemsFilePath()), { recursive: true });
  const temporaryPath = `${hiddenItemsFilePath()}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(normalized), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, hiddenItemsFilePath());
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {}
    throw error;
  }
  hiddenItemsCache = normalized;
  return normalized;
}

function mutateHiddenItems(mutator) {
  const operation = hiddenItemsMutationQueue.then(async () => {
    const current = await loadHiddenItems();
    return saveHiddenItems(mutator(current));
  });
  hiddenItemsMutationQueue = operation.catch(() => {});
  return operation;
}

function assertPersistedIdentifier(value, label) {
  const identifier = persistedIdentifier(value);
  if (!identifier) throw new TypeError(`${label} must be non-empty text.`);
  return identifier;
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
    title: "选择 Claude 导出 ZIP（新版请同时选择四类分包）",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Claude Export ZIP", extensions: ["zip"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const splitPattern =
    /^(?:light_metadata|projects|memories|conversations)-\d{3,}\.zip$/i;
  const splitSelections = result.filePaths.filter((filePath) =>
    splitPattern.test(path.basename(filePath))
  );
  let parsed;
  if (result.filePaths.length === 1 && splitSelections.length === 0) {
    parsed = await parseArchive(result.filePaths[0]);
  } else {
    if (splitSelections.length !== result.filePaths.length) {
      throw new Error(
        "旧版请选择一个完整 ZIP；新版请同时选择全部四类分包 ZIP。"
      );
    }
    if (result.filePaths.length === 1) {
      throw new Error("新版 Claude 导出请一次性选择全部四类 ZIP 分包。");
    }
    parsed = await parseSplitArchiveBatch(result.filePaths);
  }
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
  let lastNativeNavigationCommand;
  const dispatchNativeNavigationCommand = (direction, source) => {
    const timestamp = Date.now();
    if (
      lastNativeNavigationCommand?.direction === direction &&
      lastNativeNavigationCommand.source !== source &&
      timestamp - lastNativeNavigationCommand.timestamp < 250
    ) {
      return;
    }
    lastNativeNavigationCommand = { direction, source, timestamp };
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("reader:navigation-command", direction);
    }
  };
  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => {
    if (savedWindowState.maximized) window.maximize();
    window.show();
  });
  window.on("resize", () => scheduleWindowStateSave(window));
  window.on("move", () => scheduleWindowStateSave(window));
  window.on("maximize", () => scheduleWindowStateSave(window));
  window.on("unmaximize", () => scheduleWindowStateSave(window));
  window.on("app-command", (event, command) => {
    const direction =
      command === "browser-backward"
        ? "back"
        : command === "browser-forward"
          ? "forward"
          : undefined;
    if (!direction) return;
    event.preventDefault();
    dispatchNativeNavigationCommand(direction, "app-command");
  });
  if (process.platform === "win32") {
    const WM_XBUTTONUP = 0x020c;
    window.hookWindowMessage(WM_XBUTTONUP, (wParam) => {
      if (!Buffer.isBuffer(wParam) || wParam.length < 4) return;
      const xButton = (wParam.readUInt32LE(0) >>> 16) & 0xffff;
      if (xButton === 1) {
        dispatchNativeNavigationCommand("back", "xbutton");
      } else if (xButton === 2) {
        dispatchNativeNavigationCommand("forward", "xbutton");
      }
    });
  }
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
  handleTrusted("hidden:get", loadHiddenItems);
  handleTrusted("hidden:conversation", async (accountValue, conversationValue) => {
    const accountUuid = assertPersistedIdentifier(accountValue, "Account UUID");
    const conversationUuid = assertPersistedIdentifier(
      conversationValue,
      "Conversation UUID"
    );
    const library = await loadLibrary();
    const conversationExists = library.conversations.some(
      (conversation) =>
        conversation.account_uuid === accountUuid &&
        conversation.uuid === conversationUuid
    );
    if (!conversationExists) {
      throw new Error("Cannot hide a conversation that is not in the library.");
    }

    return mutateHiddenItems((current) => {
      const conversationKey = hiddenConversationKey(
        accountUuid,
        conversationUuid
      );
      if (current.conversationKeys.includes(conversationKey)) return current;
      if (current.conversationKeys.length >= MAX_HIDDEN_CONVERSATIONS) {
        throw new Error("The local hidden-conversation limit has been reached.");
      }
      return {
        ...current,
        conversationKeys: [...current.conversationKeys, conversationKey]
      };
    });
  });
  handleTrusted(
    "hidden:question",
    async (accountValue, conversationValue, messageValue) => {
      const accountUuid = assertPersistedIdentifier(accountValue, "Account UUID");
      const conversationUuid = assertPersistedIdentifier(
        conversationValue,
        "Conversation UUID"
      );
      const messageUuid = assertPersistedIdentifier(messageValue, "Message UUID");
      const library = await loadLibrary();
      const conversation = library.conversations.find(
        (item) =>
          item.account_uuid === accountUuid && item.uuid === conversationUuid
      );
      if (!conversation) {
        throw new Error("Cannot hide a question outside the selected conversation.");
      }
      if (
        !conversation.chat_messages.some(
          (message) => message.uuid === messageUuid && message.sender === "human"
        )
      ) {
        throw new Error("The selected question is not present in the conversation.");
      }

      return mutateHiddenItems((current) => {
        const conversationKey = hiddenConversationKey(
          accountUuid,
          conversationUuid
        );
        const currentQuestionIds =
          current.questionIdsByConversation[conversationKey] || [];
        if (currentQuestionIds.includes(messageUuid)) return current;
        if (
          !Object.prototype.hasOwnProperty.call(
            current.questionIdsByConversation,
            conversationKey
          ) &&
          Object.keys(current.questionIdsByConversation).length >=
            MAX_HIDDEN_CONVERSATIONS
        ) {
          throw new Error("The local hidden-question limit has been reached.");
        }
        const totalQuestions = Object.values(
          current.questionIdsByConversation
        ).reduce((total, questionIds) => total + questionIds.length, 0);
        if (totalQuestions >= MAX_HIDDEN_QUESTIONS) {
          throw new Error("The local hidden-question limit has been reached.");
        }
        return {
          ...current,
          questionIdsByConversation: {
            ...current.questionIdsByConversation,
            [conversationKey]: [...currentQuestionIds, messageUuid]
          }
        };
      });
    }
  );
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
    await mutateHiddenItems(() => structuredClone(EMPTY_HIDDEN_ITEMS));
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
