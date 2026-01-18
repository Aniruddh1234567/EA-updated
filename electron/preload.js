const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eaDesktop', {
  saveProject: (args) => ipcRenderer.invoke('ea:saveProject', args),
  openProject: () => ipcRenderer.invoke('ea:openProject'),
  openProjectAtPath: (filePath) => ipcRenderer.invoke('ea:openProjectAtPath', { filePath }),
  pickProjectFolder: () => ipcRenderer.invoke('ea:pickProjectFolder'),
  listManagedRepositories: () => ipcRenderer.invoke('ea:listManagedRepositories'),
  loadManagedRepository: (repositoryId) => ipcRenderer.invoke('ea:loadManagedRepository', { repositoryId }),
  saveManagedRepository: (args) => ipcRenderer.invoke('ea:saveManagedRepository', args),
  exportRepository: (args) => ipcRenderer.invoke('ea:exportRepository', args),
  consumePendingRepositoryImports: () => ipcRenderer.invoke('ea:consumePendingRepositoryImports'),
  onRepositoryPackageImport: (handler) => {
    ipcRenderer.on('ea:repositoryPackageImport', (_event, payload) => handler(payload));
  },
  importLegacyProjectAtPath: (filePath) => ipcRenderer.invoke('ea:importLegacyProjectAtPath', { filePath }),
  openDevTools: () => ipcRenderer.invoke('ea:openDevTools'),
});
