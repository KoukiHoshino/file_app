// preload.js
// mainプロセス（Node.js）とrendererプロセス（Webページ）間の安全な橋渡し
const { contextBridge, ipcRenderer } = require('electron');

// window.myAPI という名前で、rendererプロセスにAPIを公開
contextBridge.exposeInMainWorld('myAPI', {
  
  createFile: (data) => {
    return ipcRenderer.invoke('create-file', data);
  },

  getFilenamePreview: (data) => {
    return ipcRenderer.invoke('get-filename-preview', data);
  },

  // --- ダイアログ呼び出し ---
  selectSaveDir: () => ipcRenderer.invoke('select-save-dir'),
  selectDefaultDir: () => ipcRenderer.invoke('select-default-dir'),
  
  showConfirmationDialog: (message) => ipcRenderer.invoke('show-confirmation-dialog', message),

  // --- ★ ユーザビリティ: 【新規】フォルダ/ファイルを開く ---
  openTemplatesFolder: () => ipcRenderer.invoke('open-templates-folder'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),

  // --- JSONデータ読み込み ---
  getCategories: () => ipcRenderer.invoke('get-categories'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  getCustomTokens: () => ipcRenderer.invoke('get-custom-tokens'),

  // --- JSONデータ書き込み ---
  updateCategories: (list) => ipcRenderer.invoke('update-categories', list),
  updateProjects: (list) => ipcRenderer.invoke('update-projects', list),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  updatePresets: (list) => ipcRenderer.invoke('update-presets', list),
  updateCustomTokens: (list) => ipcRenderer.invoke('update-custom-tokens', list),

  // --- インポート/エクスポート ---
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings')
});