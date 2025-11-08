// preload.js
// mainプロセス（Node.js）とrendererプロセス（Webページ）間の安全な橋渡し
const { contextBridge, ipcRenderer } = require('electron');

// window.myAPI という名前で、rendererプロセスにAPIを公開
contextBridge.exposeInMainWorld('myAPI', {
  
  // 【変更】ファイル作成API。引数をデータオブジェクトに変更
  createFile: (data) => {
    return ipcRenderer.invoke('create-file', data);
  },

  // 【変更】プレビューAPI。引数をデータオブジェクトに変更
  getFilenamePreview: (data) => {
    return ipcRenderer.invoke('get-filename-preview', data);
  },

  // --- ダイアログ呼び出し ---
  selectSaveDir: () => ipcRenderer.invoke('select-save-dir'),
  selectDefaultDir: () => ipcRenderer.invoke('select-default-dir'),

  // --- JSONデータ読み込み ---
  getCategories: () => ipcRenderer.invoke('get-categories'),
  getProjects: () => ipcRenderer.invoke('get-projects'),
  getExtensions: () => ipcRenderer.invoke('get-extensions'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  // 【追加】カスタムトークン読み込み
  getCustomTokens: () => ipcRenderer.invoke('get-custom-tokens'),

  // --- JSONデータ書き込み ---
  updateCategories: (list) => ipcRenderer.invoke('update-categories', list),
  updateProjects: (list) => ipcRenderer.invoke('update-projects', list),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  updatePresets: (list) => ipcRenderer.invoke('update-presets', list),
  // 【追加】カスタムトークン書き込み
  updateCustomTokens: (list) => ipcRenderer.invoke('update-custom-tokens', list),

  // --- インポート/エクスポート ---
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettings: () => ipcRenderer.invoke('import-settings')
});