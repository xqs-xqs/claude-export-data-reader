const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("readerAPI", {
  importArchive: () => ipcRenderer.invoke("archive:import"),
  getLibrary: () => ipcRenderer.invoke("library:get"),
  getHiddenItems: () => ipcRenderer.invoke("hidden:get"),
  clearLibrary: () => ipcRenderer.invoke("library:clear"),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  setConversationPinned: (conversationKey, pinned) =>
    ipcRenderer.invoke("conversation:set-pinned", conversationKey, pinned),
  hideConversationLocally: (accountUuid, conversationUuid) =>
    ipcRenderer.invoke("hidden:conversation", accountUuid, conversationUuid),
  hideQuestionLocally: (accountUuid, conversationUuid, messageUuid) =>
    ipcRenderer.invoke(
      "hidden:question",
      accountUuid,
      conversationUuid,
      messageUuid
    ),
  onNavigationCommand: (handler) => {
    if (typeof handler !== "function") return () => {};
    const listener = (_event, direction) => {
      if (direction === "back" || direction === "forward") handler(direction);
    };
    ipcRenderer.on("reader:navigation-command", listener);
    return () => ipcRenderer.removeListener("reader:navigation-command", listener);
  }
});
