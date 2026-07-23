const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readerAPI", {
  importArchive: () => ipcRenderer.invoke("archive:import"),
  getLibrary: () => ipcRenderer.invoke("library:get"),
  clearLibrary: () => ipcRenderer.invoke("library:clear")
});

