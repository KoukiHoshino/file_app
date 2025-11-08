// Electronの基本的なモジュールを読み込む
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs'); // Node.jsのファイルシステムモジュール

// --- パス設定 ---
const isPackaged = app.isPackaged;
const dataBasePath = isPackaged
  ? path.join(process.resourcesPath, 'data')
  : path.join(__dirname, 'data');

// dataディレクトリが存在しない場合は作成
if (!fs.existsSync(dataBasePath)) {
  fs.mkdirSync(dataBasePath, { recursive: true });
}

const contentTemplatesPath = path.join(dataBasePath, 'content_templates');
// content_templates ディレクトリが存在しない場合は作成
if (!fs.existsSync(contentTemplatesPath)) {
  fs.mkdirSync(contentTemplatesPath, { recursive: true });
}


// ウィンドウを作成する関数
const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 700, // 高さを少し増やす
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), 
      contextIsolation: true,
      nodeIntegration: false,
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

/**
 * 【新規】JSONファイルを安全に読み込む関数
 * @param {string} fileName (例: "categories.json")
 * @param {any} defaultValue ファイルが存在しない場合に返す値
 * @returns {any} 読み込んだデータまたはデフォルト値
 */
function readJsonFile(fileName, defaultValue) {
  const filePath = path.join(dataBasePath, fileName);
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`${fileName} の読み込みに失敗:`, err);
  }
  return defaultValue;
}

/**
 * 【新規】JSONファイルを安全に書き込む関数
 * @param {string} fileName (例: "categories.json")
 * @param {any} data 書き込むデータ
 * @returns {{success: boolean, message?: string}}
 */
function writeJsonFile(fileName, data) {
  const filePath = path.join(dataBasePath, fileName);
  try {
    const jsonData = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, jsonData, 'utf8');
    return { success: true };
  } catch (err) {
    console.error(`${fileName} の書き込みに失敗:`, err);
    return { success: false, message: err.message };
  }
}

// --- 【変更】ファイル作成 (中核機能) ---
ipcMain.handle('create-file', async (event, data) => {
  
  const { saveDir, extension, description, template, values } = data;
  
  // 1. 制作者情報を config.json から取得
  const config = readJsonFile('config.json', {});
  const author = config.author || '';

  // 2. バリデーション
  if (!author) {
    return { success: false, message: '制作者が設定されていません。設定画面から設定してください。' };
  } 
  if (!saveDir) {
    return { success: false, message: '保存場所が選択されていません。' };
  }
  if (!extension) {
    return { success: false, message: 'ファイル形式が選択されていません。' };
  }
  // ▼▼▼ 修正 ▼▼▼
  // {version} 必須チェックを削除
  // ▲▲▲ 修正完了 ▲▲▲

  // 【変更】テンプレートに基づいた動的バリデーション
  const missingTokens = [];
  template.replace(/{([^{}]+)}/g, (match, key) => {
    // values にキーが存在しない、かつそれが 'freetext' や 'free_text' 以外の場合
    if (!values[key] && key !== 'free_text' && key !== 'freetext' &&
        // main側で生成するトークン以外
        key !== 'date' && key !== 'datetime' && key !== 'author' && key !== 'version') {
      missingTokens.push(match);
    }
  });

  if (missingTokens.length > 0) {
    return { success: false, message: `必須項目が入力されていません: ${missingTokens.join(', ')}` };
  }


  // 3. 【変更】全トークンの値をマージ
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const datetime = now.getFullYear() +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0') + '-' +
                   String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0');

  const allValues = {
    ...values, // rendererから来た値 (category, project, custom tokens...)
    date: date,
    datetime: datetime,
    author: author
    // version はここでは含めない
  };

  // 4. ベース名（バージョン以外）を生成
  let baseName = template;
  try {
    baseName = baseName.replace(/{([^{}]+)}/g, (match, key) => {
      if (key === 'version') return '{version}'; // version は後で置換
      // 値が空 or 未定義の場合は空文字を返す
      return allValues[key] || '';
    });
  } catch (err) {
    return { success: false, message: `テンプレートの解析に失敗: ${err.message}` };
  }


  // ▼▼▼ 修正 ▼▼▼
  // 5. 最終的なファイル名とパスを決定
  let finalFilename;
  
  if (template.includes('{version}')) {
    // 従来のバージョン管理ロジック
    let searchPattern = escapeRegExp(baseName)
      .replace(escapeRegExp('{version}'), "v(\\d{4})");

    const searchRegex = new RegExp(`^${searchPattern}${escapeRegExp(extension)}$`);
    
    const nextVersionNumber = findNextVersion(saveDir, searchRegex);
    const versionString = `v${String(nextVersionNumber).padStart(4, '0')}`;

    finalFilename = baseName.replace('{version}', versionString) + extension;
  
  } else {
    // バージョン管理なしのロジック
    finalFilename = baseName + extension;
    
    // 【重要】ファイルが既に存在するかチェック
    if (fs.existsSync(path.join(saveDir, finalFilename))) {
        return { success: false, message: `ファイルが既に存在します: ${finalFilename}` };
    }
  }

  const filePath = path.join(saveDir, finalFilename);
  // ▲▲▲ 修正完了 ▲▲▲


  // 8. ファイル内容のテンプレートを検索して書き込む
  let fileContent = '';
  try {
    const categoryValue = values.category || ''; // category が使われてるか不明だが、従来ロジックを維持
    const templateFileName = `${categoryValue}${extension}`;
    const templateFilePath = path.join(contentTemplatesPath, templateFileName);

    if (fs.existsSync(templateFilePath)) {
      fileContent = fs.readFileSync(templateFilePath, 'utf8');
      console.log(`Template loaded: '${templateFileName}'`);
    } else {
      console.log(`Template not found: '${templateFileName}'. Creating empty file.`);
    }

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

    // 【変更】ログに記録する項目を allValues から取得
    const logEntry = [
      escapeCSV(timestamp),
      escapeCSV(author),
      escapeCSV(allValues.category),
      escapeCSV(allValues.project),
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
    // ログ失敗は警告のみ
    return { success: true, message: `ファイル作成成功。ただしCSVログの記録に失敗しました: ${logErr.message}` };
  }
  
  return { success: true, message: `ファイル '${filePath}' を作成しました。` };
});


// --- 【変更】ファイル名プレビュー (中核機能) ---
ipcMain.handle('get-filename-preview', async (event, data) => {
  
  const { saveDir, extension, template, values } = data;

  const config = readJsonFile('config.json', {});
  const author = config.author || '';

  // 1. バリデーション (プレビュー用)
  if (!author) {
    return { success: false, preview: '（設定画面から制作者を登録してください）' };
  } 
  
  // 必須項目チェック (拡張子のみ)
  if (!extension) {
    return { success: false, preview: '（ファイル形式が選択されていません）' };
  }
  
  // 2. 全トークンの値をマージ
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const datetime = now.getFullYear() +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0') + '-' +
                   String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0');

  const allValues = {
    ...values,
    date: date,
    datetime: datetime,
    author: author
  };

  // 3. ベース名（バージョン以外）を生成
  let baseName = template;
  try {
    baseName = baseName.replace(/{([^{}]+)}/g, (match, key) => {
      if (key === 'version') return '{version}';
      // 【変更】値がない場合は、エラーではなくトークン名をそのまま表示（プレビューのため）
      return allValues[key] || (values[key] === '' ? '' : match); 
    });
  } catch (err) {
    return { success: false, preview: '（テンプレート解析エラー）' };
  }


  // ▼▼▼ 修正 ▼▼▼
  // 4. 最終的なファイル名を決定
  let finalFilename;

  if (template.includes('{version}')) {
    // 従来のプレビューロジック
    let versionString = 'vXXXX'; 

    if (saveDir) {
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
    finalFilename = baseName.replace('{version}', versionString) + extension;
  
  } else {
    // バージョン管理なしのプレビュー
    finalFilename = baseName + extension;
  }

  return { success: true, preview: finalFilename };
  // ▲▲▲ 修正完了 ▲▲▲
});


// --- API: フォルダ選択 ---
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


// --- API: JSONファイル読み書き ---

ipcMain.handle('get-categories', () => readJsonFile('categories.json', []));
ipcMain.handle('get-projects', () => readJsonFile('projects.json', []));
ipcMain.handle('get-extensions', () => readJsonFile('extensions.json', []));
ipcMain.handle('get-presets', () => readJsonFile('presets.json', []));
ipcMain.handle('get-custom-tokens', () => readJsonFile('custom_tokens.json', [])); // 【追加】
ipcMain.handle('get-config', () => readJsonFile('config.json', { author: '', defaultSavePath: '', namingTemplate: '{date}_{category}_{project}_{version}' }));

ipcMain.handle('update-categories', (event, data) => writeJsonFile('categories.json', data));
ipcMain.handle('update-projects', (event, data) => writeJsonFile('projects.json', data));
ipcMain.handle('update-config', (event, data) => writeJsonFile('config.json', data));
ipcMain.handle('update-presets', (event, data) => writeJsonFile('presets.json', data));
ipcMain.handle('update-custom-tokens', (event, data) => writeJsonFile('custom_tokens.json', data)); // 【追加】


// --- API: インポート/エクスポート ---
ipcMain.handle('export-settings', async () => {
  try {
    // 1. 全てのJSONデータを読み込む
    const backupData = {
      categories: readJsonFile('categories.json', []),
      projects: readJsonFile('projects.json', []),
      extensions: readJsonFile('extensions.json', []),
      config: readJsonFile('config.json', {}),
      presets: readJsonFile('presets.json', []),
      customTokens: readJsonFile('custom_tokens.json', []) // 【追加】
    };
    
    const backupJson = JSON.stringify(backupData, null, 2);

    // 2. 「保存」ダイアログを開く
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
    // 1. 「開く」ダイアログ
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

    // 2. データが正しい形式か簡易チェック
    // 【変更】customTokens もチェック対象に
    if (!backupData || !Array.isArray(backupData.categories) || !Array.isArray(backupData.projects) || 
        !Array.isArray(backupData.extensions) || !Array.isArray(backupData.presets) || 
        !Array.isArray(backupData.customTokens) || !backupData.config) {
      throw new Error('ファイルの形式が正しくありません。');
    }

    // 3. 全てのJSONを上書き
    writeJsonFile('categories.json', backupData.categories);
    writeJsonFile('projects.json', backupData.projects);
    writeJsonFile('extensions.json', backupData.extensions);
    writeJsonFile('config.json', backupData.config);
    writeJsonFile('presets.json', backupData.presets);
    writeJsonFile('custom_tokens.json', backupData.customTokens); // 【追加】

    return { success: true, message: '設定をインポートしました。' };

  } catch (err) {
    console.error('インポート失敗:', err);
    return { success: false, message: `インポートに失敗しました: ${err.message}` };
  }
});