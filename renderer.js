// renderer.js

// 選択された保存先パスを保持する変数
let selectedSaveDir = null;
// 現在の命名規則テンプレートを保持する変数
let currentNamingTemplate = '{date}_{category}_{project}_{version}';

// --- UI要素のキャッシュ (DOMContentLoadedで設定) ---
let saveDirText, categorySelect, projectSelect, extensionSelect, freetextInput, descriptionInput;
let filenamePreview, groupCategory, groupProject, groupFreetext;
let notification;

// --- 通知表示用の関数 ---
let notificationTimer = null;
function showNotification(message, isError = false) {
  // notification 要素がまだ取得できていなければ取得
  if (!notification) notification = document.getElementById('notification');
  
  if (notificationTimer) {
    clearTimeout(notificationTimer);
  }
  notification.textContent = message;
  notification.className = isError ? 'show error' : 'show';
  notificationTimer = setTimeout(() => {
    notification.className = isError ? 'error' : '';
  }, 3000);
}

// --- ドロップダウンを生成するヘルパー関数 ---
async function populateDropdown(selectId, getItemsFunction) {
  const selectElement = document.getElementById(selectId);
  selectElement.innerHTML = ''; // クリア
  
  try {
    const options = await getItemsFunction(); // API呼び出し (getCategories など)
    if (!options || options.length === 0) {
      selectElement.innerHTML = '<option value="">リストが空です</option>';
      return;
    }
    
    options.forEach((optionText, index) => {
      const option = document.createElement('option');
      option.value = optionText;
      option.textContent = optionText;
      
      // 【追加】リストの先頭 (indexが0) の項目を 'selected' (選択済み) にする
      if (index === 0) {
        option.selected = true;
      }
      
      selectElement.appendChild(option);
    });
  } catch (err) {
    console.error(err);
    selectElement.innerHTML = '<option value="">読み込み失敗</option>';
  }
}

// --- 【方針①】動的フォーム: 命名規則に基づいてフォームの表示/非表示を切り替える ---
function updateFormVisibility(template) {
  // DOM要素がまだ読み込まれていなければ何もしない
  if (!groupCategory || !groupProject || !groupFreetext) return;

  // {token} が含まれているかチェック
  const showCategory = template.includes('{category}');
  const showProject = template.includes('{project}');
  const showFreeText = template.includes('{free_text}');

  // CSSクラス (hidden) を付け外しする
  groupCategory.classList.toggle('hidden', !showCategory);
  groupProject.classList.toggle('hidden', !showProject);
  groupFreetext.classList.toggle('hidden', !showFreeText);

  // もし非表示になったら、値をリセット（プレビューに影響するため）
  if (!showCategory) categorySelect.value = '';
  if (!showProject) projectSelect.value = '';
  if (!showFreeText) freetextInput.value = '';
}

// --- 【方針②】プレビュー: ファイル名プレビューを更新する ---
async function updatePreview() {
  // DOM要素がまだ読み込まれていなければ何もしない
  if (!filenamePreview) return; 

  // 現在のフォームの値を取得
  const saveDir = selectedSaveDir;
  // DOM要素が読み込まれる前に呼び出された場合を考慮
  const category = categorySelect ? categorySelect.value : '';
  const project = projectSelect ? projectSelect.value : '';
  const extension = extensionSelect ? extensionSelect.value : '';
  const freetext = freetextInput ? freetextInput.value : '';

  // APIを呼び出してプレビューを取得
  try {
    const result = await window.myAPI.getFilenamePreview(saveDir, category, project, extension, freetext);
    filenamePreview.textContent = result.preview;
    // エラー時は .error クラスを付与 (style.cssで赤文字になる)
    filenamePreview.classList.toggle('error', !result.success);
  } catch (err) {
    filenamePreview.textContent = '（プレビューエラー）';
    filenamePreview.classList.add('error');
  }
}


// --- 設定モーダル内のリストを更新する関数 (変更なし) ---
async function refreshSettingsList(listId, getItemsFunction, updateItemsFunction) {
  const listElement = document.getElementById(listId);
  listElement.innerHTML = '<li>読み込み中...</li>';

  try {
    const items = await getItemsFunction();
    listElement.innerHTML = ''; // クリア

    if (items.length === 0) {
      listElement.innerHTML = '<li>アイテムはありません</li>';
    }

    items.forEach((itemText, index) => {
      const li = document.createElement('li');
      
      const span = document.createElement('span');
      span.textContent = itemText;
      li.appendChild(span);

      const deleteButton = document.createElement('button');
      deleteButton.className = 'delete-item-button';
      deleteButton.title = '削除';
      deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
      
      deleteButton.addEventListener('click', async () => {
        if (!confirm(`「${itemText}」を削除しますか？`)) {
          return;
        }
        const newItems = items.filter((_, i) => i !== index);
        const result = await updateItemsFunction(newItems);
        if (result.success) {
          showNotification('削除しました', false);
          refreshSettingsList(listId, getItemsFunction, updateItemsFunction);
        } else {
          showNotification('削除に失敗しました', true);
        }
      });
      
      li.appendChild(deleteButton);
      listElement.appendChild(li);
    });
  } catch (err) {
    listElement.innerHTML = '<li>リストの読み込みに失敗</li>';
  }
}

// --- DOM（HTML）の読み込みが完了したら実行 ---
window.addEventListener('DOMContentLoaded', async () => {
  
  // --- UI要素の取得 (メインフォーム) ---
  const createButton = document.getElementById('create-button');
  const selectDirButton = document.getElementById('select-dir-button');
  saveDirText = document.getElementById('save_dir');
  categorySelect = document.getElementById('attr_category');
  projectSelect = document.getElementById('attr_project');
  extensionSelect = document.getElementById('attr_extension');
  descriptionInput = document.getElementById('attr_description');
  freetextInput = document.getElementById('attr_freetext');

  // 【追加】方針①、②で必要な要素
  filenamePreview = document.getElementById('filename-preview');
  groupCategory = document.getElementById('group-category');
  groupProject = document.getElementById('group-project');
  groupFreetext = document.getElementById('group-freetext');
  notification = document.getElementById('notification'); // 通知要素もキャッシュ

  // --- UI要素の取得 (設定モーダル) ---
  const settingsModal = document.getElementById('settings-modal');
  const openSettingsButton = document.getElementById('open-settings-button');
  const closeSettingsButton = document.getElementById('close-settings-button');
  const categoriesList = document.getElementById('categories-list');
  const projectsList = document.getElementById('projects-list');
  const newCategoryInput = document.getElementById('new-category-input');
  const addCategoryButton = document.getElementById('add-category-button');
  const newProjectInput = document.getElementById('new-project-input');
  const addProjectButton = document.getElementById('add-project-button');
  const defaultPathInput = document.getElementById('default-path-input');
  const browseDefaultPathButton = document.getElementById('browse-default-path-button');
  const namingTemplateInput = document.getElementById('naming-template-input');
  const importSettingsButton = document.getElementById('import-settings-button');
  const exportSettingsButton = document.getElementById('export-settings-button');
  const authorInput = document.getElementById('author-input');

  // --- メインフォームのドロップダウンを初期化 ---
  async function refreshMainDropdowns() {
    await Promise.all([
      populateDropdown('attr_category', window.myAPI.getCategories),
      populateDropdown('attr_project', window.myAPI.getProjects),
      populateDropdown('attr_extension', window.myAPI.getExtensions)
    ]);
    // 【変更】ドロップダウン更新後、プレビューも更新
    updatePreview();
  }
  refreshMainDropdowns(); // 起動時に実行

  // 【変更】起動時にデフォルトパスと設定（命名規則）を読み込む
  (async () => {
    try {
      const config = await window.myAPI.getConfig();
      if (config.defaultSavePath) {
        saveDirText.value = config.defaultSavePath;
        selectedSaveDir = config.defaultSavePath;
      }
      // 命名規則をグローバル変数に保存
      currentNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';

      // 【追加】起動時にフォーム表示切替とプレビュー更新を実行
      updateFormVisibility(currentNamingTemplate);
      updatePreview();

    } catch (err) {
      console.error('設定の読み込みに失敗', err);
      // エラー時もデフォルトのテンプレートでフォーム表示とプレビューを実行
      updateFormVisibility(currentNamingTemplate);
      updatePreview();
    }
  })();

  // --- イベントリスナーの登録 ---

  // (1) メインフォーム: 「フォルダを選択」
  selectDirButton.addEventListener('click', async () => {
    const result = await window.myAPI.selectSaveDir();
    if (result.success) {
      saveDirText.value = result.path;
      selectedSaveDir = result.path;
      // 【追加】プレビュー更新
      updatePreview();
    }
  });

  // (2) メインフォーム: 「ファイル作成」
  createButton.addEventListener('click', async () => {
    const saveDir = selectedSaveDir; 
    const category = categorySelect.value;
    const project = projectSelect.value;
    const extension = extensionSelect.value;
    const description = descriptionInput.value;
    const freetext = freetextInput.value;

    const result = await window.myAPI.createFile(saveDir, category, project, extension, description, freetext);

    if (result.success) {
      showNotification(result.message, false);
      descriptionInput.value = ''; 
      freetextInput.value = ''; 
      // 【追加】作成成功後、プレビューを再更新（次のバージョンを表示するため）
      updatePreview();
    } else {
      showNotification(result.message, true);
    }
  });

  // (3) 設定モーダル: 「設定」ボタン (モーダルを開く)
  openSettingsButton.addEventListener('click', async () => {
      try {
        // 【変更】最新のconfigを読み込む
        const config = await window.myAPI.getConfig();
        authorInput.value = config.author || '';
        defaultPathInput.value = config.defaultSavePath || '';
        namingTemplateInput.value = config.namingTemplate || '{date}_{category}_{project}_{version}';
        // グローバル変数も同期
        currentNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';
      } catch (err) {
        showNotification('設定の読み込みに失敗', true);
      }
      settingsModal.style.display = 'flex';
      refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
      refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
  });

  // (4) 設定モーダル: 「閉じる」ボタン (モーダルを閉じる)
  closeSettingsButton.addEventListener('click', async () => {
    
    const template = namingTemplateInput.value.trim();
    if (!template.includes('{version}')) {
      showNotification('エラー: 命名規則に {version} トークンは必須です。', true);
      return;
    }

    // 【追加】ファイル名として不正な文字がないかチェック
    const illegalChars = /[\\/:*?"<>|]/;
    if (illegalChars.test(template)) {
      showNotification('エラー: テンプレートに \\ / : * ? " < > | は使用できません', true);
      return;
    }

    // 【追加】括弧のバランスが取れているか簡易チェック (厳密ではないが十分)
    if (template.split('{').length !== template.split('}').length) {
      showNotification('エラー: テンプレートの{ } の数が一致しません', true);
      return;
    }

    try {
      const configToSave = {
        author: authorInput.value.trim(),
        defaultSavePath: defaultPathInput.value.trim(),
        namingTemplate: template
      };
      await window.myAPI.updateConfig(configToSave); 
      
      // 【追加】保存したテンプレートをグローバル変数に反映
      currentNamingTemplate = template;

    } catch (err) {
      showNotification('設定の保存に失敗', true);
    }
    
    settingsModal.style.display = 'none';
    
    // 【追加】フォーム表示とプレビューを更新
    updateFormVisibility(currentNamingTemplate);
    refreshMainDropdowns(); // ドロップダウンを再読み込み (プレビューも内部で更新される)
  });

  // (5) 設定モーダル: 「分類を追加」ボタン
  addCategoryButton.addEventListener('click', async () => {
    const newItem = newCategoryInput.value.trim();
    if (!newItem) {
      showNotification('分類名を入力してください', true);
      return;
    }
    const currentItems = await window.myAPI.getCategories();

    if (currentItems.includes(newItem)) {
      showNotification('エラー: その名前は既に使用されています', true);
      return;
    }

    currentItems.push(newItem);
    const result = await window.myAPI.updateCategories(currentItems);
    if (result.success) {
      showNotification('追加しました', false);
      newCategoryInput.value = '';
      refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
    } else {
      showNotification('追加に失敗しました', true);
    }
  });

  // (6) 設定モーダル: 「プロジェクトを追加」ボタン
  addProjectButton.addEventListener('click', async () => {
    const newItem = newProjectInput.value.trim();
    if (!newItem) {
      showNotification('プロジェクト名を入力してください', true);
      return;
    }
    const currentItems = await window.myAPI.getProjects();

    if (currentItems.includes(newItem)) {
      showNotification('エラー: その名前は既に使用されています', true);
      return;
    }

    currentItems.push(newItem);
    const result = await window.myAPI.updateProjects(currentItems);
    if (result.success) {
      showNotification('追加しました', false);
      newProjectInput.value = '';
      refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
    } else {
      showNotification('追加に失敗しました', true);
    }
  });

  // (7) 設定モーダル: 「エクスポート」ボタン
  exportSettingsButton.addEventListener('click', async () => {
    const result = await window.myAPI.exportSettings();
    if (result.success) {
      showNotification(result.message, false);
    } else {
      showNotification(result.message, true);
    }
  });

  // (8) 設定モーダル: 「インポート」ボタン
  importSettingsButton.addEventListener('click', async () => {
    if (!confirm('現在の設定は上書きされます。よろしいですか？')) {
      return;
    }
    const result = await window.myAPI.importSettings();
    if (result.success) {
      showNotification(result.message, false);
      // 【修正】インポート成功時、設定モーダル内の表示も更新
      const config = await window.myAPI.getConfig();
      authorInput.value = config.author || '';
      defaultPathInput.value = config.defaultSavePath || '';
      namingTemplateInput.value = config.namingTemplate || '{date}_{category}_{project}_{version}';
      // グローバル変数も更新
      currentNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';
      
      refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
      refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
    } else {
      showNotification(result.message, true);
    }
  });

  // (9) 設定モーダル: 「デフォルトパス参照」ボタン
  browseDefaultPathButton.addEventListener('click', async () => {
    const result = await window.myAPI.selectDefaultDir();
    if (result.success) {
      defaultPathInput.value = result.path;
    }
  });

  // --- 【方針②】プレビュー用のイベントリスナー ---
  // メインフォームの入力が変更されたらプレビューを更新
  categorySelect.addEventListener('change', updatePreview);
  projectSelect.addEventListener('change', updatePreview);
  extensionSelect.addEventListener('change', updatePreview);
  freetextInput.addEventListener('input', updatePreview);

});