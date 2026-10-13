const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("postStudioDesktop", {
  isDesktop: true,
});
