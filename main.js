// Electronの基本的なモジュールを読み込む
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs'); // Node.jsのファイルシステムモジュール

// --- パス設定 ---
const isPackaged = app.isPackaged;
const dataBasePath = isPackaged
  ? path.join(process.resourcesPath, 'data')
  : path.join(__dirname, 'data');

const contentTemplatesPath = path.join(dataBasePath, 'content_templates');

// ウィンドウを作成する関数
const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), // preload.jsを読み込む
      // (1) コンテキスト分離を明示的に有効化 (必須)
      // これが true でないと、preload.js の contextBridge が機能しません。
      // 現在の設計の前提となる最も重要な設定です。
      contextIsolation: true,

      // (2) レンダラープロセスでの Node.js 統合を明示的に無効化 (必須)
      // これを false にすることで、Webページ側 (index.html, renderer.js) で
      // 'require()' などの Node.js 機能が使えなくなります。
      nodeIntegration: false,

      // (3) Web Worker での Node.js 統合も無効化
      nodeIntegrationInWorker: false
    }
  });
  win.loadFile('index.html');
  // win.webContents.openDevTools(); // デバッグ用
};

// --- アプリのライフサイクル ---
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- 補助関数 ---
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 指定された正規表現にマッチするファイルの最大バージョンを探す
 * @param {string} directory
 * @param {RegExp} regex (例: /^20251107_\[議事録\]_v(\d{4})\.txt$/)
 * @returns {number} 次のバージョン番号
 */
function findNextVersion(directory, regex) {
  let maxVersion = 0;
  try {
    const files = fs.readdirSync(directory);
    for (const file of files) {
      const match = file.match(regex);
      if (match && match[1]) {
        const currentVersion = parseInt(match[1], 10);
        if (currentVersion > maxVersion) {
          maxVersion = currentVersion;
        }
      }
    }
  } catch (err) {
    console.error(`フォルダ読み取りエラー: ${err.message}`);
  }
  return maxVersion + 1;
}

// --- ファイル作成 (中核機能) ---
ipcMain.handle('create-file', async (event, saveDir, category, project, extension, description, freetext) => { // 【変更】freetext を追加
  
  let config = {};
  let author = '';
  try {
    const configPath = path.join(dataBasePath, 'config.json');
    config = JSON.parse(fs.readFileSync(configPath, 'utf8')); 
    author = config.author || '';
  } catch (err) {
    // config.json がない場合
  }

  // 1. バリデーション
  if (!author) {
    return { success: false, message: '制作者が設定されていません。設定画面から設定してください。' };
  } 
  if (!saveDir) {
    return { success: false, message: '保存場所が選択されていません。' };
  }
  if (!category) {
    return { success: false, message: '分類が選択されていません。' };
  }
  if (!project) {
    return { success: false, message: 'プロジェクトが選択されていません。' };
  }
  if (!extension) {
    return { success: false, message: 'ファイル形式が選択されていません。' };
  }

  // 2. 命名規則テンプレートの取得
  const template = config.namingTemplate || '{date}_{category}_{project}_{version}';
  if (!template.includes('{version}')) {
    return { success: false, message: '命名規則エラー: {version} トークンが見つかりません。設定をリセットしてください。' };
  }

  // 3. 【変更】全トークンの値を準備
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const datetime = now.getFullYear() +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0') + '-' +
                   String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0');

  // 4. ベース名（バージョン以外）を生成
  let baseName = template
    .replace('{date}', date)
    .replace('{datetime}', datetime) // {datetime} を置換
    .replace('{category}', category)
    .replace('{project}', project)
    .replace('{author}', author)     // {author} を置換
    .replace('{free_text}', freetext || ''); // {free_text} を置換 (空の場合は空文字)

  // 5. バージョン検索用の正規表現を作成
  // (freetext の内容もエスケープされる)
  let searchPattern = escapeRegExp(baseName)
    .replace(escapeRegExp('{version}'), "v(\\d{4})");

  const searchRegex = new RegExp(`^${searchPattern}${escapeRegExp(extension)}$`);
  
  // 6. 次のバージョン番号を取得
  const nextVersionNumber = findNextVersion(saveDir, searchRegex);
  const versionString = `v${String(nextVersionNumber).padStart(4, '0')}`;

  // 7. 最終的なファイル名を決定
  const finalFilename = baseName.replace('{version}', versionString) + extension;
  const filePath = path.join(saveDir, finalFilename);

  // 8. ファイル内容のテンプレートを検索して書き込む
  let fileContent = ''; // デフォルトは空
  try {
    // テンプレートファイル名を決定 (例: "[議事録].txt")
    // category の名前 (例: "[議事録]") と extension (例: ".txt") を組み合わせる
    const templateFileName = `${category}${extension}`;
    const templateFilePath = path.join(contentTemplatesPath, templateFileName);

    // テンプレートファイルが存在するかチェック
    if (fs.existsSync(templateFilePath)) {
      // 存在すれば内容を読み込む
      fileContent = fs.readFileSync(templateFilePath, 'utf8');
      // 【変更】日本語から英語のログに変更
      console.log(`Template loaded: '${templateFileName}'`);
    } else {
      // 【変更】日本語から英語のログに変更
      console.log(`Template not found: '${templateFileName}'. Creating empty file.`);
    }

    // ファイルを書き込む
    fs.writeFileSync(filePath, fileContent, 'utf8'); 

  } catch (err) {
    console.error(err);
    return { success: false, message: `ファイルの作成/書き込みに失敗しました: ${err.message}` };
  }

  // 9. CSVログの自動保存
  try {
    const logFilePath = path.join(dataBasePath, 'creation_log.csv');
    const timestamp = new Date().toISOString();
    
    const escapeCSV = (str) => `"${String(str || '').replace(/"/g, '""')}"`;

    const logEntry = [
      escapeCSV(timestamp),
      escapeCSV(author),
      escapeCSV(category),
      escapeCSV(project),
      escapeCSV(finalFilename),
      escapeCSV(filePath),
      escapeCSV(description)
    ].join(',') + '\n';

    if (!fs.existsSync(logFilePath)) {
      const header = "Timestamp,Author,Category,Project,Filename,SavePath,Description\n";
      fs.writeFileSync(logFilePath, header, 'utf8');
    }
    
    fs.appendFileSync(logFilePath, logEntry, 'utf8');

  } catch (logErr) {
    console.error('CSVログの書き込みに失敗:', logErr);
    return { success: true, message: `ファイル作成成功。ただしCSVログの記録に失敗しました: ${logErr.message}` };
  }
  
  return { success: true, message: `ファイル '${filePath}' を作成しました。` };
});

// --- API: フォルダ選択 (メイン画面用) ---
ipcMain.handle('select-save-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '保存先フォルダの選択',
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) {
    return { success: false, path: null };
  }
  return { success: true, path: filePaths[0] };
});

// --- API: フォルダ選択 (設定画面用) ---
ipcMain.handle('select-default-dir', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'デフォルトの保存先フォルダを選択',
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) {
    return { success: false, path: null };
  }
  return { success: true, path: filePaths[0] };
});


// --- API: リスト/設定ファイル読み込み ---
ipcMain.handle('get-categories', () => {
  try {
    const filePath = path.join(dataBasePath, 'categories.json');
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('categories.json の読み込みに失敗:', err);
    return [];
  }
});

ipcMain.handle('get-projects', () => {
  try {
    const filePath = path.join(dataBasePath, 'projects.json');
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('projects.json の読み込みに失敗:', err);
    return [];
  }
});

ipcMain.handle('get-extensions', () => {
  try {
    const filePath = path.join(dataBasePath, 'extensions.json');
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('extensions.json の読み込みに失敗:', err);
    return [];
  }
});

ipcMain.handle('get-config', () => {
  try {
    const filePath = path.join(dataBasePath, 'config.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
    return { author: '', defaultSavePath: '', namingTemplate: '{date}_{category}_{project}_{version}' };
  } catch (err) {
    console.error('config.json の読み込みに失敗:', err);
    return { author: '', defaultSavePath: '', namingTemplate: '{date}_{category}_{project}_{version}' };
  }
});

// --- API: リスト/設定ファイル書き込み ---
ipcMain.handle('update-categories', (event, categoriesArray) => {
  try {
    const filePath = path.join(dataBasePath, 'categories.json');
    const data = JSON.stringify(categoriesArray, null, 2); 
    fs.writeFileSync(filePath, data, 'utf8');
    return { success: true };
  } catch (err) {
    console.error('categories.json の書き込みに失敗:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('update-projects', (event, projectsArray) => {
  try {
    const filePath = path.join(dataBasePath, 'projects.json');
    const data = JSON.stringify(projectsArray, null, 2);
    fs.writeFileSync(filePath, data, 'utf8');
    return { success: true };
  } catch (err) {
    console.error('projects.json の書き込みに失敗:', err);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('update-config', (event, configObject) => {
  try {
    const filePath = path.join(dataBasePath, 'config.json');
    const data = JSON.stringify(configObject, null, 2);
    fs.writeFileSync(filePath, data, 'utf8');
    return { success: true };
  } catch (err) {
    console.error('config.json の書き込みに失敗:', err);
    return { success: false, message: err.message };
  }
});

// --- API: インポート/エクスポート ---
ipcMain.handle('export-settings', async () => {
  try {
    // 1. 全てのJSONファイルを読み込む
    const categoriesPath = path.join(dataBasePath, 'categories.json');
    const projectsPath = path.join(dataBasePath, 'projects.json');
    const extensionsPath = path.join(dataBasePath, 'extensions.json'); // extensions もエクスポート対象に追加
    const configPath = path.join(dataBasePath, 'config.json');
    
    const categoriesData = fs.readFileSync(categoriesPath, 'utf8');
    const projectsData = fs.readFileSync(projectsPath, 'utf8');
    const extensionsData = fs.readFileSync(extensionsPath, 'utf8');
    const configData = fs.readFileSync(configPath, 'utf8');

    // 2. データを一つのオブジェクトにまとめる
    const backupData = {
      categories: JSON.parse(categoriesData),
      projects: JSON.parse(projectsData),
      extensions: JSON.parse(extensionsData),
      config: JSON.parse(configData)
    };
    
    const backupJson = JSON.stringify(backupData, null, 2);

    // 3. 「保存」ダイアログを開く
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '設定をエクスポート',
      defaultPath: 'file_app_settings.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (canceled || !filePath) {
      return { success: false, message: 'エクスポートがキャンセルされました。' };
    }

    fs.writeFileSync(filePath, backupJson, 'utf8');
    return { success: true, message: `設定を ${filePath} に保存しました。` };

  } catch (err) {
    console.error('エクスポート失敗:', err);
    return { success: false, message: `エクスポートに失敗しました: ${err.message}` };
  }
});

ipcMain.handle('import-settings', async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '設定をインポート',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, message: 'インポートがキャンセルされました。' };
    }

    const filePath = filePaths[0];
    const backupJson = fs.readFileSync(filePath, 'utf8');
    const backupData = JSON.parse(backupJson);

    // 3. データが正しい形式か簡易チェック
    if (!backupData || !Array.isArray(backupData.categories) || !Array.isArray(backupData.projects) || !Array.isArray(backupData.extensions) || !backupData.config) {
      throw new Error('ファイルの形式が正しくありません。');
    }

    // 4. 全てのJSONを上書き
    fs.writeFileSync(path.join(dataBasePath, 'categories.json'), JSON.stringify(backupData.categories, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataBasePath, 'projects.json'), JSON.stringify(backupData.projects, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataBasePath, 'extensions.json'), JSON.stringify(backupData.extensions, null, 2), 'utf8');
    fs.writeFileSync(path.join(dataBasePath, 'config.json'), JSON.stringify(backupData.config, null, 2), 'utf8');

    return { success: true, message: '設定をインポートしました。' };

  } catch (err) {
    console.error('インポート失敗:', err);
    return { success: false, message: `インポートに失敗しました: ${err.message}` };
  }
});

ipcMain.handle('get-filename-preview', async (event, saveDir, category, project, extension, freetext) => {
  
  let config = {};
  let author = '';
  // 【追加】template変数をここで定義
  let template = '{date}_{category}_{project}_{version}'; 

  try {
    const configPath = path.join(dataBasePath, 'config.json');
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8')); 
      author = config.author || '';
      
      // 【変更】configから読み込んだテンプレートを変数に格納
      template = config.namingTemplate || template; 
    }
  } catch (err) {
    // config.json が読み込めなくてもプレビューは続行
  }

  // 1. バリデーション (プレビュー用)
  if (!author) {
    // 【修正】 message ではなく preview プロパティでエラーを返す
    return { success: false, preview: '（設定画面から制作者を登録してください）' };
  } 
  if (!saveDir) {
    // 【修正】 バージョン検索ができないだけで、プレビュー自体は可能なため
    // このチェックは削除、または「vXXXX」と表示するロジック（現状）のままでOK
  }

  // 【修正点】テンプレートにトークンが含まれている場合のみチェック
  if (template.includes('{category}') && !category) {
    return { success: false, preview: '（分類が選択されていません）' };
  }
  if (template.includes('{project}') && !project) {
    return { success: false, preview: '（プロジェクトが選択されていません）' };
  }
  
  // ファイル形式は必須（ファイル名の一部ではないが、ファイルの作成に必須なため）
  if (!extension) {
    return { success: false, preview: '（ファイル形式が選択されていません）' };
  }

  // 2. 全トークンの値を準備
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const now = new Date();
  const datetime = now.getFullYear() +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0') + '-' +
                   String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0');

  // 3. ベース名（バージョン以外）を生成
  let baseName = template
    .replace('{date}', date)
    .replace('{datetime}', datetime)
    .replace('{category}', category)
    .replace('{project}', project)
    .replace('{author}', author)
    .replace('{free_text}', freetext || '');

  // 4. バージョン検索
  let versionString = 'vXXXX'; // デフォルト (保存先未選択時)

  if (saveDir) {
    // 保存先が指定されている場合のみ、次のバージョンを検索
    try {
      let searchPattern = escapeRegExp(baseName)
        .replace(escapeRegExp('{version}'), "v(\\d{4})");
      const searchRegex = new RegExp(`^${searchPattern}${escapeRegExp(extension)}$`);
      
      const nextVersionNumber = findNextVersion(saveDir, searchRegex);
      versionString = `v${String(nextVersionNumber).padStart(4, '0')}`;
    } catch (err) {
      console.error("プレビュー時のバージョン検索エラー:", err);
      versionString = 'vERR!'; // 検索失敗時
    }
  }

  // 5. 最終的なファイル名を決定
  const finalFilename = baseName.replace('{version}', versionString) + extension;

  return { success: true, preview: finalFilename };
});