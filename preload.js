// preload.js
// mainプロセス（Node.js）とrendererプロセス（Webページ）間の安全な橋渡し
const { contextBridge, ipcRenderer } = require('electron');

// window.myAPI という名前で、rendererプロセスにAPIを公開
contextBridge.exposeInMainWorld('myAPI', {
  
  // ファイル作成（中核機能）
  // 【変更】freetext を引数に追加
  createFile: (saveDir, category, project, extension, description, freetext) => {
    return ipcRenderer.invoke('create-file', saveDir, category, project, extension, description, freetext);
  },

  getFilenamePreview: (saveDir, category, project, extension, freetext) => {
    return ipcRenderer.invoke('get-filename-preview', saveDir, category, project, extension, freetext);
  },

  // --- ダイアログ呼び出し ---
  selectSaveDir: () => ipcRenderer.invoke('select-save-dir'),
  selectDefaultDir: () => ipcRenderer.invoke('select-default-dir'),

  // --- JSONデータ読み込み ---
  getCategories: () => ipcRenderer.invoke('get-categories'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  getConfig: () => ipcRenderer.invoke('get-config'),

  // --- JSONデータ書き込み ---
  updateCategories: (list) => ipcRenderer.invoke('update-categories', list),
  updateProjects: (list) => ipcRenderer.invoke('update-projects', list),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),

  // --- インポート/エクスポート ---
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings')
});