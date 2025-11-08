// Electronの基本的なモジュールを読み込む
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises'); // ★ 堅牢性: 非同期I/Oのためにインポート

// --- パス設定 ---
const isPackaged = app.isPackaged;
const dataBasePath = isPackaged
  ? path.join(process.resourcesPath, 'data')
  : path.join(__dirname, 'data');

// dataディレクトリが存在しない場合は作成 (同期処理でOK)
if (!fs.existsSync(dataBasePath)) {
  fs.mkdirSync(dataBasePath, { recursive: true });
}

const contentTemplatesPath = path.join(dataBasePath, 'content_templates');
// content_templates ディレクトリが存在しない場合は作成 (同期処理でOK)
if (!fs.existsSync(contentTemplatesPath)) {
  fs.mkdirSync(contentTemplatesPath, { recursive: true });
}


// ウィンドウを作成する関数
const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 700,
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

/**
 * ★ 堅牢性: 【変更】次のバージョン番号を非同期で検索
 * @param {string} directory 検索するディレクトリ
 * @param {RegExp} regex バージョンを抽出する正規表現
 * @returns {Promise<number>} 次のバージョン番号
 */
async function findNextVersionAsync(directory, regex) {
  let maxVersion = 0;
  try {
    const files = await fsPromises.readdir(directory); // ★ 非同期に変更
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
    // 読み取りエラー（権限など）はバージョン0として扱う
    console.warn(`フォルダ読み取りエラー: ${err.message}`);
  }
  return maxVersion + 1;
}

/**
 * ★ 堅牢性: 【変更】JSONファイルを安全に読み込む関数 (非同期)
 * @param {string} fileName (例: "categories.json")
 * @param {any} defaultValue ファイルが存在しない場合に返す値
 * @returns {Promise<any>} 読み込んだデータまたはデフォルト値
 */
async function readJsonFile(fileName, defaultValue) {
  const filePath = path.join(dataBasePath, fileName);
  try {
    // fs.existsSync は同期のまま（ファイル存在チェックは高速なため許容）
    if (fs.existsSync(filePath)) {
      const stats = await fsPromises.stat(filePath); // 非同期
      if (stats.size > 10 * 1024 * 1024) { // 10MB
        console.error(`${fileName} の読み込み失敗: ファイルサイズが大きすぎます。`);
        return defaultValue;
      }
      const data = await fsPromises.readFile(filePath, 'utf8'); // 非同期
      return JSON.parse(data);
    }
  } catch (err) {
    console.error(`${fileName} の読み込みに失敗:`, err);
  }
  return defaultValue;
}

/**
 * ★ 堅牢性: 【変更】JSONファイルを安全に書き込む関数 (非同期)
 * @param {string} fileName (例: "categories.json")
 * @param {any} data 書き込むデータ
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function writeJsonFile(fileName, data) {
  const filePath = path.join(dataBasePath, fileName);
  try {
    const jsonData = JSON.stringify(data, null, 2);
    await fsPromises.writeFile(filePath, jsonData, 'utf8'); // 非同期
    return { success: true };
  } catch (err) {
    console.error(`${fileName} の書き込みに失敗:`, err);
    return { success: false, message: err.message };
  }
}

// ★ 堅牢性: パス関連の文字をサニタイズするヘルパー
function sanitizeForFileName(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/(\.\.[/\\])|[/\\]|[:*?"<>|]/g, ''); 
}

// ★ 堅牢性: saveDir が危険なパスでないか検証するヘルパー
function isValidSaveDir(saveDir) {
  if (typeof saveDir !== 'string' || !saveDir) return false;
  const normalizedPath = path.normalize(saveDir);
  if (normalizedPath.includes('..')) {
    return false;
  }
  if (!path.isAbsolute(normalizedPath)) {
    return false;
  }
  return true;
}

/**
 * ★ 堅牢性: 【新規】ディレクトリが書き込み可能かチェックするヘルパー
 * @param {string} directoryPath
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function checkDirectoryWritable(directoryPath) {
  try {
    await fsPromises.access(directoryPath, fs.constants.W_OK); // 非同期
    return { success: true };
  } catch (err) {
    console.warn(`書き込み権限エラー: ${directoryPath}`, err);
    return { success: false, message: '選択された保存場所への書き込み権限がありません。' };
  }
}


// --- 【変更】ファイル作成 (中核機能) ---
ipcMain.handle('create-file', async (event, data) => {
  
  const { saveDir, extension, description, template, values } = data;
  
  // 1. 制作者情報を config.json から取得 (★ 非同期に変更)
  const config = await readJsonFile('config.json', {});
  const author = config.author || '';

  // 2. バリデーション
  if (!author) {
    return { success: false, message: '制作者が設定されていません。設定画面から設定してください。' };
  } 
  
  if (!isValidSaveDir(saveDir)) {
    return { success: false, message: '保存場所のパスが無効です。' };
  }
  
  // ★ 堅牢性: 書き込み権限チェックを最初に行う
  const writableCheck = await checkDirectoryWritable(saveDir);
  if (!writableCheck.success) {
    return { success: false, message: writableCheck.message };
  }
  
  const saneExtension = sanitizeForFileName(extension);
  if (saneExtension !== extension || !saneExtension) {
    return { success: false, message: 'ファイル形式の値が無効です。' };
  }
  
  // テンプレートに基づいた動的バリデーション
  const missingTokens = [];
  template.replace(/{([^{}]+)}/g, (match, key) => {
    if (!values[key] && key !== 'free_text' && key !== 'freetext' &&
        key !== 'date' && key !== 'datetime' && key !== 'author' && key !== 'version') {
      missingTokens.push(match);
    }
  });

  if (missingTokens.length > 0) {
    return { success: false, message: `必須項目が入力されていません: ${missingTokens.join(', ')}` };
  }

  // 3. 全トークンの値をマージ
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const datetime = now.getFullYear() +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0') + '-' +
                   String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0');

  const allValues = { ...values, date, datetime, author };

  // 4. ベース名（バージョン以外）を生成
  let baseName = template;
  try {
    baseName = baseName.replace(/{([^{}]+)}/g, (match, key) => {
      if (key === 'version') return '{version}'; 
      const saneValue = sanitizeForFileName(allValues[key] || '');
      return saneValue;
    });
  } catch (err) {
    return { success: false, message: `テンプレートの解析に失敗: ${err.message}` };
  }

  // 5. 最終的なファイル名とパスを決定
  let finalFilename;
  
  if (template.includes('{version}')) {
    let searchPattern = escapeRegExp(baseName)
      .replace(escapeRegExp('{version}'), "v(\\d{4})");
    const searchRegex = new RegExp(`^${searchPattern}${escapeRegExp(saneExtension)}$`);
    
    // ★ 修正: 非同期関数を呼び出す
    const nextVersionNumber = await findNextVersionAsync(saveDir, searchRegex);
    const versionString = `v${String(nextVersionNumber).padStart(4, '0')}`;
    finalFilename = baseName.replace('{version}', versionString) + saneExtension;
  } else {
    finalFilename = baseName + saneExtension;
    // ★ 堅牢性: fs.existsSync は同期だが、1回きりの呼び出しなので許容
    if (fs.existsSync(path.join(saveDir, finalFilename))) {
        return { success: false, message: `ファイルが既に存在します: ${finalFilename}` };
    }
  }

  const filePath = path.join(saveDir, finalFilename);

  // 8. ファイル内容のテンプレートを検索して書き込む
  let fileContent = '';
  try {
    const categoryValue = sanitizeForFileName(values.category || '');
    const templateFileName = `${categoryValue}${saneExtension}`;
    const templateFilePath = path.join(contentTemplatesPath, templateFileName);
    const resolvedTemplatePath = path.resolve(templateFilePath);
    const resolvedBase = path.resolve(contentTemplatesPath);
    
    if (resolvedTemplatePath.startsWith(resolvedBase)) {
      // ★ 堅牢性: fs.existsSync は同期だが、1回きりの呼び出しなので許容
      if (fs.existsSync(templateFilePath)) {
        fileContent = await fsPromises.readFile(templateFilePath, 'utf8'); // ★ 非同期
        console.log(`Template loaded: '${templateFileName}'`);
      } else {
        console.log(`Template not found: '${templateFileName}'. Creating empty file.`);
      }
    } else {
      console.warn(`セキュリティ警告: テンプレートパスが不正です (Path Traversalの試行?): ${templateFileName}`);
    }

    await fsPromises.writeFile(filePath, fileContent, 'utf8'); // ★ 非同期

  } catch (err) {
    console.error(err);
    return { success: false, message: `ファイルの作成/書き込みに失敗しました: ${err.message}` };
  }

  // 9. CSVログの自動保存
  try {
    const logFilePath = path.join(dataBasePath, 'creation_log.csv');
    const timestamp = new Date().toISOString();
    
    // ★ セキュリティ: CSVインジェクション対策を強化
    const escapeCSV = (str) => {
      let safeStr = String(str || '').replace(/"/g, '""');
      // 数式として解釈されるのを防ぐ
      if (['=', '+', '-', '@'].includes(safeStr.charAt(0))) {
        safeStr = `'${safeStr}`; // 先頭にシングルクォートを追加
      }
      return `"${safeStr}"`;
    };

    const logEntry = [
      escapeCSV(timestamp),
      escapeCSV(author),
      escapeCSV(allValues.category),
      escapeCSV(allValues.project),
      escapeCSV(finalFilename),
      escapeCSV(filePath),
      escapeCSV(description)
    ].join(',') + '\n';

    // ★ 堅牢性: fs.existsSync は同期だが、1回きりの呼び出しなので許容
    if (!fs.existsSync(logFilePath)) {
      const header = "Timestamp,Author,Category,Project,Filename,SavePath,Description\n";
      await fsPromises.writeFile(logFilePath, header, 'utf8'); // ★ 非同期
    }
    
    await fsPromises.appendFile(logFilePath, logEntry, 'utf8'); // ★ 非同期

  } catch (logErr) {
    console.error('CSVログの書き込みに失敗:', logErr);
    return { success: true, message: `ファイル作成成功。ただしCSVログの記録に失敗しました: ${logErr.message}` };
  }
  
  return { success: true, message: `ファイル '${filePath}' を作成しました。` };
});


// --- 【変更】ファイル名プレビュー (中核機能) ---
ipcMain.handle('get-filename-preview', async (event, data) => {
  
  const { saveDir, extension, template, values } = data;

  const config = await readJsonFile('config.json', {}); // ★ 非同期
  const author = config.author || '';

  if (!author) {
    return { success: false, preview: '（設定画面から制作者を登録してください）' };
  } 
  
  const saneExtension = sanitizeForFileName(extension || '');

  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const datetime = now.getFullYear() +
                   String(now.getMonth() + 1).padStart(2, '0') +
                   String(now.getDate()).padStart(2, '0') + '-' +
                   String(now.getHours()).padStart(2, '0') +
                   String(now.getMinutes()).padStart(2, '0') +
                   String(now.getSeconds()).padStart(2, '0');

  const allValues = { ...values, date, datetime, author };

  let baseName = template;
  try {
    baseName = baseName.replace(/{([^{}]+)}/g, (match, key) => {
      if (key === 'version') return '{version}';
      const saneValue = sanitizeForFileName(allValues[key] || '');
      return allValues[key] != null ? saneValue : (values[key] === '' ? '' : match); 
    });
  } catch (err) {
    return { success: false, preview: '（テンプレート解析エラー）' };
  }

  let finalFilename;

  if (template.includes('{version}')) {
    let versionString = 'vXXXX'; 

    if (isValidSaveDir(saveDir)) {
      // ★ 堅牢性: プレビュー時も権限をチェック
      const writableCheck = await checkDirectoryWritable(saveDir);
      if (!writableCheck.success) {
        versionString = 'vPERM!'; // Permission Error
      } else {
        try {
          let searchPattern = escapeRegExp(baseName)
            .replace(escapeRegExp('{version}'), "v(\\d{4})");
          const searchRegex = new RegExp(`^${searchPattern}${escapeRegExp(saneExtension)}$`);
          
          // ★ 修正: 非同期関数を呼び出す
          const nextVersionNumber = await findNextVersionAsync(saveDir, searchRegex);
          versionString = `v${String(nextVersionNumber).padStart(4, '0')}`;
        } catch (err) {
          console.error("プレビュー時のバージョン検索エラー:", err);
          versionString = 'vERR!';
        }
      }
    }
    finalFilename = baseName.replace('{version}', versionString) + saneExtension;
  
  } else {
    finalFilename = baseName + saneExtension;
  }

  return { success: true, preview: finalFilename };
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

// ★ セキュリティ: 【新規】ネイティブ確認ダイアログ
ipcMain.handle('show-confirmation-dialog', async (event, message) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: '確認',
    message: message,
    buttons: ['キャンセル', 'OK'],
    defaultId: 1, // 'OK' をデフォルト
    cancelId: 0
  });
  return response === 1; // OK が押されたら true
});


// --- API: JSONファイル読み書き (非同期対応) ---
ipcMain.handle('get-categories', () => readJsonFile('categories.json', []));
ipcMain.handle('get-projects', () => readJsonFile('projects.json', []));
ipcMain.handle('get-extensions', () => readJsonFile('extensions.json', []));
ipcMain.handle('get-presets', () => readJsonFile('presets.json', []));
ipcMain.handle('get-custom-tokens', () => readJsonFile('custom_tokens.json', []));
ipcMain.handle('get-config', () => readJsonFile('config.json', { 
    author: '', 
    defaultSavePath: '', 
    namingTemplate: '{date}_{category}_{project}_{version}',
    lastUsedPresetId: '' 
}));

ipcMain.handle('update-categories', (event, data) => writeJsonFile('categories.json', data));
ipcMain.handle('update-projects', (event, data) => writeJsonFile('projects.json', data));
ipcMain.handle('update-config', (event, data) => writeJsonFile('config.json', data));
ipcMain.handle('update-presets', (event, data) => writeJsonFile('presets.json', data));
ipcMain.handle('update-custom-tokens', (event, data) => writeJsonFile('custom_tokens.json', data));


// --- API: インポート/エクスポート (非同期対応) ---
ipcMain.handle('export-settings', async () => {
  try {
    // 1. 全てのJSONデータを並列で読み込む (★ 非同期)
    const [
      categories, projects, extensions, config, presets, customTokens
    ] = await Promise.all([
      readJsonFile('categories.json', []),
      readJsonFile('projects.json', []),
      readJsonFile('extensions.json', []),
      readJsonFile('config.json', {}),
      readJsonFile('presets.json', []),
      readJsonFile('custom_tokens.json', [])
    ]);

    const backupData = { categories, projects, extensions, config, presets, customTokens };
    const backupJson = JSON.stringify(backupData, null, 2);

    // 2. 「保存」ダイアログ
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '設定をエクスポート',
      defaultPath: 'file_app_settings.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (canceled || !filePath) {
      return { success: false, message: 'エクスポートがキャンセルされました。' };
    }

    await fsPromises.writeFile(filePath, backupJson, 'utf8'); // ★ 非同期
    return { success: true, message: `設定を ${filePath} に保存しました。` };

  } catch (err) {
    console.error('エクスポート失敗:', err);
    return { success: false, message: `エクスポートに失敗しました: ${err.message}` };
  }
});

// ★ 堅牢性: インポートデータの型チェック
function isValidImportData(data) {
  if (!data) return false;
  const checkArray = (key) => data.hasOwnProperty(key) && Array.isArray(data[key]);
  const checkObject = (key) => data.hasOwnProperty(key) && typeof data[key] === 'object' && data[key] !== null && !Array.isArray(data[key]);
  return checkArray('categories') &&
         checkArray('projects') &&
         checkArray('extensions') &&
         checkArray('presets') &&
         checkArray('customTokens') &&
         checkObject('config');
}

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

    // ★ 堅牢性: 1. ファイルサイズチェック (非同期)
    const stats = await fsPromises.stat(filePath); // ★ 非同期
    if (stats.size > 10 * 1024 * 1024) { // 10MB limit
      return { success: false, message: 'インポート失敗: ファイルサイズが大きすぎます (最大10MB)。' };
    }
    
    const backupJson = await fsPromises.readFile(filePath, 'utf8'); // ★ 非同期
    const backupData = JSON.parse(backupJson);

    if (!isValidImportData(backupData)) {
      throw new Error('ファイルの形式が正しくありません。必要なキーやデータ型が不足しています。');
    }

    // 3. 全てのJSONを並列で上書き (★ 非同期)
    await Promise.all([
      writeJsonFile('categories.json', backupData.categories),
      writeJsonFile('projects.json', backupData.projects),
      writeJsonFile('extensions.json', backupData.extensions),
      writeJsonFile('config.json', backupData.config),
      writeJsonFile('presets.json', backupData.presets),
      writeJsonFile('custom_tokens.json', backupData.customTokens)
    ]);

    return { success: true, message: '設定をインポートしました。' };

  } catch (err) {
    console.error('インポート失敗:', err);
    return { success: false, message: `インポートに失敗しました: ${err.message}` };
  }
});