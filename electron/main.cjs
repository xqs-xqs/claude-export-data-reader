const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { mergeByKey, parseArchive } = require("./archive.cjs");

const EMPTY_LIBRARY = {
  version: 1,
  imports: [],
  accounts: [],
  conversations: [],
  projects: []
};

let mainWindow;
let libraryCache;

function dataFilePath() {
  return path.join(app.getPath("userData"), "reader-data.json");
}

async function loadLibrary() {
  if (libraryCache) return libraryCache;
  try {
    libraryCache = JSON.parse(await readFile(dataFilePath(), "utf8"));
  } catch {
    libraryCache = structuredClone(EMPTY_LIBRARY);
  }
  return libraryCache;
}

async function saveLibrary(library) {
  await mkdir(path.dirname(dataFilePath()), { recursive: true });
  const temporaryPath = `${dataFilePath()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(library), "utf8");
  const { rename } = require("node:fs/promises");
  await rename(temporaryPath, dataFilePath());
  libraryCache = library;
}

async function importArchive() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 Claude 数据导出 ZIP",
    properties: ["openFile"],
    filters: [{ name: "ZIP archive", extensions: ["zip"] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };

  const parsed = await parseArchive(result.filePaths[0]);
  const library = await loadLibrary();
  if (library.imports.some((item) => item.sha256 === parsed.sha256)) {
    return {
      canceled: false,
      duplicate: true,
      filename: parsed.filename,
      library
    };
  }

  const nextLibrary = {
    ...library,
    imports: [
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
    )
  };

  await saveLibrary(nextLibrary);
  return {
    canceled: false,
    duplicate: false,
    filename: parsed.filename,
    importedConversations: parsed.conversations.length,
    library: nextLibrary
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f7f6f2",
    title: "Claude 数据阅读器",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    mainWindow.loadURL(developmentUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("archive:import", importArchive);
  ipcMain.handle("library:get", loadLibrary);
  ipcMain.handle("library:clear", async () => {
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
