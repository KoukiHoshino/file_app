// renderer.js

// --- グローバル変数 ---
let selectedSaveDir = null;
let defaultNamingTemplate = '{date}_{category}_{project}_{version}';
let activeNamingTemplate = '{date}_{category}_{project}_{version}';
let allPresets = [];
let allCustomTokens = []; 
let allCategories = []; // 【追加】分類リストのキャッシュ
let allProjects = []; // 【追加】プロジェクトリストのキャッシュ

// 【追加】編集モード管理
let editingItemId = null;
let editingListType = null; // 'category', 'project', 'customToken', 'preset'

// 【追加】D&D中のIDをグローバルに保持
let draggedItemId = null;
let draggedListType = null;

// --- UI要素のキャッシュ (DOMContentLoadedで設定) ---
let saveDirText, categorySelect, projectSelect, extensionSelect, freetextInput, descriptionInput;
let filenamePreview, groupCategory, groupProject, groupFreetext;
let notification;
let presetSelect;
let customTokensContainer; 
// (設定モーダル内の要素は都度取得)


// --- 通知表示用の関数 ---
let notificationTimer = null;
function showNotification(message, isError = false) {
  if (!notification) notification = document.getElementById('notification');
  if (notificationTimer) clearTimeout(notificationTimer);
  notification.textContent = message;
  notification.className = isError ? 'show error' : 'show';
  notificationTimer = setTimeout(() => {
    notification.className = isError ? 'error' : '';
  }, 3000);
}

// --- ヘルパー関数: 分類・プロジェクトのドロップダウン生成 ---
async function populateDropdown(selectId, getItemsFunction, addEmptyOption = false) {
  const selectElement = document.getElementById(selectId);
  if (!selectElement) return;
  selectElement.innerHTML = ''; // クリア
  
  if (addEmptyOption) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '（指定なし）';
    selectElement.appendChild(emptyOption);
  }

  try {
    const options = await getItemsFunction(); 
    
    // 【追加】キャッシュ更新 (populateDropdownが呼ばれるのはデータ更新時なので)
    if (getItemsFunction === window.myAPI.getCategories) allCategories = options;
    if (getItemsFunction === window.myAPI.getProjects) allProjects = options;

    if (!options || options.length === 0) {
      if (!addEmptyOption) {
        selectElement.innerHTML = '<option value="">リストが空です</option>';
      }
      return;
    }
    
    options.forEach((optionText, index) => {
      const option = document.createElement('option');
      option.value = optionText;
      option.textContent = optionText;
      if (!addEmptyOption && index === 0) {
        option.selected = true;
      }
      selectElement.appendChild(option);
    });
  } catch (err) {
    console.error(`ドロップダウン読み込み失敗 (ID: ${selectId}):`, err);
    selectElement.innerHTML = '<option value="">読み込み失敗</option>';
  }
}

// --- ヘルパー関数: マイセットドロップダウンを生成 ---
async function populatePresetsDropdown() {
  if (!presetSelect) return; 
  try {
    allPresets = await window.myAPI.getPresets();
    const currentSelectedValue = presetSelect.value;
    presetSelect.innerHTML = ''; // クリア
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '（マイセットを選択...）';
    presetSelect.appendChild(defaultOption);

    allPresets.forEach(preset => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.setName;
      presetSelect.appendChild(option);
    });
    
    presetSelect.value = currentSelectedValue;
  } catch (err) {
    console.error('マイセットの読み込みに失敗', err);
    presetSelect.innerHTML = '<option value="">（読み込み失敗）</option>';
  }
}

// --- 【新規】ヘルパー関数: カスタムトークンフォームの動的生成 ---
async function loadAndRenderCustomTokens() {
  try {
    allCustomTokens = await window.myAPI.getCustomTokens();
  } catch (err) {
    console.error('カスタムトークンの読み込みに失敗', err);
    allCustomTokens = [];
  }

  // 1. メインフォームのコンテナ
  if (!customTokensContainer) {
    customTokensContainer = document.getElementById('custom-tokens-container');
  }
  customTokensContainer.innerHTML = ''; // クリア

  // 2. 設定モーダル（マイセット追加）のコンテナ
  const newPresetCustomContainer = document.getElementById('new-preset-custom-tokens-container');
  if (newPresetCustomContainer) {
    newPresetCustomContainer.innerHTML = ''; // クリア
  }

  allCustomTokens.forEach(token => {
    const key = token.tokenName.replace(/[{}]/g, '');

    // --- メインフォーム用の入力欄を生成 ---
    const mainGroup = document.createElement('div');
    mainGroup.className = 'input-group';
    
    const mainLabel = document.createElement('label');
    mainLabel.htmlFor = `custom_token_${token.id}`;
    mainLabel.textContent = `${token.label}:`;
    mainGroup.appendChild(mainLabel);

    const mainInput = document.createElement('input');
    mainInput.type = 'text';
    mainInput.id = `custom_token_${token.id}`;
    mainInput.className = 'custom-token-input'; // CSSと選択用
    mainInput.dataset.tokenKey = key; // キーを保存
    mainInput.placeholder = `(${token.tokenName} の値)`;
    mainInput.addEventListener('input', updatePreview); 
    mainGroup.appendChild(mainInput);

    customTokensContainer.appendChild(mainGroup);

    // --- 設定モーダル（マイセット追加）用の入力欄を生成 ---
    if (newPresetCustomContainer) {
      const presetGroup = document.createElement('div');
      presetGroup.className = 'input-group';

      const presetLabel = document.createElement('label');
      presetLabel.htmlFor = `new_preset_custom_token_${token.id}`;
      presetLabel.textContent = `${token.label} (プリセット値):`;
      presetGroup.appendChild(presetLabel);

      const presetInput = document.createElement('input');
      presetInput.type = 'text';
      presetInput.id = `new_preset_custom_token_${token.id}`;
      presetInput.className = 'new-preset-custom-input'; // CSSと選択用
      presetInput.dataset.tokenKey = key; // キーを保存
      presetInput.placeholder = `（オプション）`;
      presetGroup.appendChild(presetInput);
      
      newPresetCustomContainer.appendChild(presetGroup);
    }
  });
}

// --- 【新規】ヘルパー関数: 編集フォームをリセット ---
function resetAddForms() {
  editingItemId = null;
  editingListType = null;

  // 全ての追加フォームの入力欄をクリア
  // 分類
  document.getElementById('new-category-input').value = '';
  // プロジェクト
  document.getElementById('new-project-input').value = '';
  // カスタムトークン
  document.getElementById('new-token-name').value = '';
  document.getElementById('new-token-label').value = '';
  // マイセット
  document.getElementById('new-preset-name').value = '';
  document.getElementById('new-preset-saveDir').value = '';
  document.getElementById('new-preset-template').value = '';
  document.getElementById('new-preset-category').value = '';
  document.getElementById('new-preset-project').value = '';
  document.getElementById('new-preset-extension').value = '';
  document.getElementById('new-preset-freetext').value = '';
  document.querySelectorAll('#new-preset-custom-tokens-container .new-preset-custom-input').forEach(input => {
    input.value = '';
  });

  // 全てのボタンを「追加」モードに戻す
  setButtonMode(document.getElementById('add-category-button'), 'add');
  setButtonMode(document.getElementById('add-project-button'), 'add');
  setButtonMode(document.getElementById('add-token-button'), 'add');
  setButtonMode(document.getElementById('add-preset-button'), 'add');
}

// --- 【新規】ヘルパー関数: ボタンのモード切り替え ---
function setButtonMode(buttonElement, mode) { // mode: 'add' or 'update'
  if (!buttonElement) return;
  
  const isWide = buttonElement.classList.contains('wide-button');
  
  if (mode === 'update') {
    buttonElement.classList.add('update-mode');
    if (isWide) {
      buttonElement.innerHTML = '<i class="fas fa-save"></i> この内容で更新';
    } else {
      buttonElement.textContent = '更新';
    }
  } else { // 'add'
    buttonElement.classList.remove('update-mode');
    if (isWide) {
      buttonElement.innerHTML = '<i class="fas fa-plus"></i> このセットを追加'; // マイセット/トークン固有
    } else {
      buttonElement.textContent = '+'; // 分類/プロジェクト固有
    }
  }
  // トークン追加ボタンのテキストを修正
  if (buttonElement.id === 'add-token-button') {
    buttonElement.innerHTML = mode === 'update' ? '<i class="fas fa-save"></i> このトークンを更新' : '<i class="fas fa-plus"></i> このトークンを追加';
  }
}

// --- 【新規】ヘルパー関数: アイテムを編集フォームに読み込む ---
function loadItemForEditing(listType, itemId) {
  // 編集状態を設定
  editingItemId = itemId;
  editingListType = listType;

  // 他のフォームをリセット（ボタンテキストなどを戻すため）
  resetAddForms();
  // 再度、編集状態を設定
  editingItemId = itemId;
  editingListType = listType;

  switch (listType) {
    case 'category':
      document.getElementById('new-category-input').value = itemId;
      setButtonMode(document.getElementById('add-category-button'), 'update');
      document.getElementById('new-category-input').focus();
      break;
    
    case 'project':
      document.getElementById('new-project-input').value = itemId;
      setButtonMode(document.getElementById('add-project-button'), 'update');
      document.getElementById('new-project-input').focus();
      break;

    case 'customToken':
      const token = allCustomTokens.find(t => t.id === itemId);
      if (token) {
        document.getElementById('new-token-name').value = token.tokenName;
        document.getElementById('new-token-label').value = token.label;
        setButtonMode(document.getElementById('add-token-button'), 'update');
        document.getElementById('new-token-name').focus();
      }
      break;

    case 'preset':
      const preset = allPresets.find(p => p.id === itemId);
      if (preset) {
        document.getElementById('new-preset-name').value = preset.setName;
        document.getElementById('new-preset-saveDir').value = preset.saveDir;
        document.getElementById('new-preset-template').value = preset.template;
        
        const values = preset.presetValues || {};
        document.getElementById('new-preset-category').value = values.category || '';
        document.getElementById('new-preset-project').value = values.project || '';
        document.getElementById('new-preset-extension').value = values.extension || '';
        document.getElementById('new-preset-freetext').value = values.free_text || '';
        
        document.querySelectorAll('#new-preset-custom-tokens-container .new-preset-custom-input').forEach(input => {
          input.value = values[input.dataset.tokenKey] || '';
        });
        
        setButtonMode(document.getElementById('add-preset-button'), 'update');
        document.getElementById('new-preset-name').focus();
      }
      break;
  }
}

// --- 【新規】ヘルパー関数: D&D用のハイライトをすべてクリア ---
function clearAllDragHighlights() {
  document.querySelectorAll('.settings-list-container li').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging');
  });
  document.querySelectorAll('.settings-list-container').forEach(el => {
    el.classList.remove('drag-over-container');
  });
}


// --- 【変更】ヘルパー関数: フォーム表示切替 ---
function updateFormVisibility(template) {
  if (!groupCategory || !groupProject || !groupFreetext) return;

  const showCategory = template.includes('{category}');
  const showProject = template.includes('{project}');
  const showFreeText = template.includes('{free_text}');

  groupCategory.classList.toggle('hidden', !showCategory);
  groupProject.classList.toggle('hidden', !showProject);
  groupFreetext.classList.toggle('hidden', !showFreeText);

  allCustomTokens.forEach(token => {
    const container = document.getElementById(`custom_token_${token.id}`)?.parentElement;
    if (container) {
      const showCustom = template.includes(token.tokenName);
      container.classList.toggle('hidden', !showCustom);
      if (!showCustom) {
        container.querySelector('input').value = ''; 
      }
    }
  });

  if (!showCategory) categorySelect.value = '';
  if (!showProject) projectSelect.value = '';
  if (!showFreeText) freetextInput.value = '';
}

// --- 【変更】ヘルパー関数: 現在のフォーム値を取得する ---
function collectFormValues() {
  const values = {
    category: categorySelect.value,
    project: projectSelect.value,
    free_text: freetextInput.value
  };

  // 動的に生成されたカスタムトークン入力から値を取得
  const customTokenElements = document.querySelectorAll('#custom-tokens-container .custom-token-input');
  customTokenElements.forEach(input => {
    const tokenKey = input.dataset.tokenKey; // (例: "client")
    values[tokenKey] = input.value;
  });
  
  return values;
}


// --- 【変更】ヘルパー関数: プレビュー更新 ---
async function updatePreview() {
  if (!filenamePreview) return; 

  const values = collectFormValues();
  const extension = extensionSelect.value; 

  const data = {
    saveDir: selectedSaveDir,
    extension: extension, 
    template: activeNamingTemplate,
    values: values 
  };

  try {
    const result = await window.myAPI.getFilenamePreview(data);
    filenamePreview.textContent = result.preview;
    filenamePreview.classList.toggle('error', !result.success);
  } catch (err) {
    filenamePreview.textContent = '（プレビューエラー）';
    filenamePreview.classList.add('error');
  }
}


// --- 【★変更★】ヘルパー関数: 設定モーダル内のリスト更新 (分類・プロジェクト用) ---
async function refreshSettingsList(listId, getItemsFunction, updateItemsFunction) {
  const listElement = document.getElementById(listId);
  const listContainer = listElement.parentElement;
  const listType = (listId === 'categories-list') ? 'category' : 'project';
  
  listElement.innerHTML = '<li>読み込み中...</li>';

  try {
    const items = await getItemsFunction();
    
    // 【変更】キャッシュ更新
    let currentCache = [];
    if (listType === 'category') {
      allCategories = items;
      currentCache = allCategories;
    } else {
      allProjects = items;
      currentCache = allProjects;
    }
    
    listElement.innerHTML = ''; 

    if (items.length === 0) {
      listElement.innerHTML = '<li>アイテムはありません</li>';
    }

    // --- 【★追加★】コンテナ（一番下）へのD&Dイベント ---
    listContainer.ondragover = (e) => {
      e.preventDefault();
      if (draggedListType === listType) {
        e.dataTransfer.dropEffect = 'move';
        // アイテム上のハイライトは消す
        document.querySelectorAll(`#${listId} li`).forEach(li => {
          li.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        listContainer.classList.add('drag-over-container');
      }
    };
    listContainer.ondragleave = (e) => {
      e.preventDefault();
      listContainer.classList.remove('drag-over-container');
    };
    listContainer.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      listContainer.classList.remove('drag-over-container');
      
      if (draggedListType !== listType || !draggedItemId) return;

      const draggedIndex = currentCache.findIndex(item => item === draggedItemId);
      if (draggedIndex === -1 || draggedIndex === currentCache.length - 1) {
        // 見つからない or 既に一番下
        draggedItemId = null;
        draggedListType = null;
        return;
      }
      
      // 配列から削除
      const [draggedItem] = currentCache.splice(draggedIndex, 1);
      // 配列の末尾に追加
      currentCache.push(draggedItem);
      
      // API呼び出し
      const result = await updateItemsFunction(currentCache);
      if (result.success) {
        refreshSettingsList(listId, getItemsFunction, updateItemsFunction);
        refreshMainDropdowns();
        populateDropdown(listType === 'category' ? 'new-preset-category' : 'new-preset-project', getItemsFunction, true);
      } else {
        showNotification('並び替えに失敗', true);
      }
      draggedItemId = null;
      draggedListType = null;
    };


    items.forEach((itemText, index) => {
      const li = document.createElement('li');
      
      // --- 【★追加★】D&Dイベント (li) ---
      li.draggable = true;
      li.dataset.itemId = itemText; // IDとして項目名をそのまま使用

      li.addEventListener('dragstart', (e) => {
        draggedItemId = itemText;
        draggedListType = listType;
        e.dataTransfer.setData('text/plain', itemText);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => li.classList.add('dragging'), 0);
      });
      
      li.addEventListener('dragend', () => {
        clearAllDragHighlights();
        draggedItemId = null;
        draggedListType = null;
      });

      // ▼▼▼ 修正 ▼▼▼
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation(); // ★★★ 修正: イベントの伝播を停止 ★★★
        
        if (draggedListType !== listType) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        if (draggedItemId === itemText) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }

        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          li.classList.add('drag-over-top');
          li.classList.remove('drag-over-bottom');
        } else {
          li.classList.add('drag-over-bottom');
          li.classList.remove('drag-over-top');
        }
        listContainer.classList.remove('drag-over-container');
      });
      // ▲▲▲ 修正完了 ▲▲▲
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        
        if (draggedListType !== listType || !draggedItemId || draggedItemId === itemText) {
          clearAllDragHighlights();
          return;
        }

        const draggedIndex = currentCache.findIndex(item => item === draggedItemId);
        let droppedIndex = currentCache.findIndex(item => item === itemText);
        
        if (draggedIndex === -1 || droppedIndex === -1) return;

        const rect = li.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY > midY) {
          droppedIndex++; // 下半分にドロップ: インデックスを+1
        }
        
        const newItems = [...currentCache];
        const [draggedItem] = newItems.splice(draggedIndex, 1);
        if (draggedIndex < droppedIndex) droppedIndex--;
        newItems.splice(droppedIndex, 0, draggedItem);
        
        const result = await updateItemsFunction(newItems);
        if (result.success) {
          refreshSettingsList(listId, getItemsFunction, updateItemsFunction);
          refreshMainDropdowns();
          populateDropdown(listType === 'category' ? 'new-preset-category' : 'new-preset-project', getItemsFunction, true);
        } else {
          showNotification('並び替えに失敗', true);
        }
        clearAllDragHighlights();
        draggedItemId = null;
        draggedListType = null;
      });
      // --- D&D (li) ここまで ---

      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'item-content';
      contentDiv.textContent = itemText;
      li.appendChild(contentDiv);

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'item-controls';

      // --- 【★削除★】「上へ」「下へ」ボタンのロジックを削除 ---
      
      // --- 編集ボタン ---
      const editButton = document.createElement('button');
      editButton.className = 'list-button edit-item-button';
      editButton.title = '編集';
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener('click', () => {
        loadItemForEditing(listType, itemText); // itemText が ID の代わり
      });
      controlsDiv.appendChild(editButton);
      
      // --- 削除ボタン ---
      const deleteButton = document.createElement('button');
      deleteButton.className = 'list-button delete-item-button';
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
          refreshMainDropdowns(); // メインフォームも更新
          // 【追加】マイセットのドロップダウンも更新
          if (listId === 'categories-list') populateDropdown('new-preset-category', window.myAPI.getCategories, true);
          if (listId === 'projects-list') populateDropdown('new-preset-project', window.myAPI.getProjects, true);
        } else {
          showNotification('削除に失敗しました', true);
        }
      });
      
      controlsDiv.appendChild(deleteButton);
      li.appendChild(controlsDiv);
      listElement.appendChild(li);
    });
  } catch (err) {
    listElement.innerHTML = '<li>リストの読み込みに失敗</li>';
  }
}

// --- 【★変更★】ヘルパー関数: 設定モーダル内の「カスタムトークン」リスト更新 ---
async function refreshCustomTokensList() {
  const listElement = document.getElementById('custom-tokens-list');
  const listContainer = listElement.parentElement;
  const listType = 'customToken';
  
  listElement.innerHTML = '<li>読み込み中...</li>';

  try {
    allCustomTokens = await window.myAPI.getCustomTokens();
    listElement.innerHTML = ''; // クリア

    if (allCustomTokens.length === 0) {
      listElement.innerHTML = '<li>アイテムはありません</li>';
    }

    // --- 【★追加★】コンテナ（一番下）へのD&Dイベント ---
    listContainer.ondragover = (e) => {
      e.preventDefault();
      if (draggedListType === listType) {
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll(`#custom-tokens-list li`).forEach(li => {
          li.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        listContainer.classList.add('drag-over-container');
      }
    };
    listContainer.ondragleave = (e) => {
      e.preventDefault();
      listContainer.classList.remove('drag-over-container');
    };
    listContainer.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      listContainer.classList.remove('drag-over-container');
      
      if (draggedListType !== listType || !draggedItemId) return;

      const draggedIndex = allCustomTokens.findIndex(item => item.id === draggedItemId);
      if (draggedIndex === -1 || draggedIndex === allCustomTokens.length - 1) {
        draggedItemId = null;
        draggedListType = null;
        return;
      }
      
      const [draggedItem] = allCustomTokens.splice(draggedIndex, 1);
      allCustomTokens.push(draggedItem);
      
      const result = await window.myAPI.updateCustomTokens(allCustomTokens);
      if (result.success) {
        refreshCustomTokensList();
        loadAndRenderCustomTokens();
      } else {
        showNotification('並び替えに失敗', true);
      }
      draggedItemId = null;
      draggedListType = null;
    };


    allCustomTokens.forEach((token, index) => {
      const li = document.createElement('li');
      
      // --- 【★追加★】D&Dイベント (li) ---
      li.draggable = true;
      li.dataset.itemId = token.id;

      li.addEventListener('dragstart', (e) => {
        draggedItemId = token.id;
        draggedListType = listType;
        e.dataTransfer.setData('text/plain', token.id);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => li.classList.add('dragging'), 0);
      });
      
      li.addEventListener('dragend', () => {
        clearAllDragHighlights();
        draggedItemId = null;
        draggedListType = null;
      });

      // ▼▼▼ 修正 ▼▼▼
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation(); // ★★★ 修正: イベントの伝播を停止 ★★★

        if (draggedListType !== listType) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        if (draggedItemId === token.id) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        
        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          li.classList.add('drag-over-top');
          li.classList.remove('drag-over-bottom');
        } else {
          li.classList.add('drag-over-bottom');
          li.classList.remove('drag-over-top');
        }
        listContainer.classList.remove('drag-over-container');
      });
      // ▲▲▲ 修正完了 ▲▲▲
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        
        if (draggedListType !== listType || !draggedItemId || draggedItemId === token.id) {
          clearAllDragHighlights();
          return;
        }

        const draggedIndex = allCustomTokens.findIndex(item => item.id === draggedItemId);
        let droppedIndex = allCustomTokens.findIndex(item => item.id === token.id);
        
        if (draggedIndex === -1 || droppedIndex === -1) return;

        const rect = li.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY > midY) {
          droppedIndex++; // 下半分にドロップ: インデックスを+1
        }
        
        const newItems = [...allCustomTokens];
        const [draggedItem] = newItems.splice(draggedIndex, 1);
        if (draggedIndex < droppedIndex) droppedIndex--;
        newItems.splice(droppedIndex, 0, draggedItem);
        
        const result = await window.myAPI.updateCustomTokens(newItems);
        if (result.success) {
          refreshCustomTokensList();
          loadAndRenderCustomTokens();
        } else {
          showNotification('並び替えに失敗', true);
        }
        clearAllDragHighlights();
        draggedItemId = null;
        draggedListType = null;
      });
      // --- D&D (li) ここまで ---
      
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'item-content';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'token-name';
      nameSpan.textContent = token.tokenName; // {client}
      contentDiv.appendChild(nameSpan);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'token-label';
      labelSpan.textContent = `Label: ${token.label}`; // 顧客名
      contentDiv.appendChild(labelSpan);
      
      li.appendChild(contentDiv);

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'item-controls';

      // --- 【★削除★】「上へ」「下へ」ボタンのロジックを削除 ---
      
      // --- 編集ボタン ---
      const editButton = document.createElement('button');
      editButton.className = 'list-button edit-item-button';
      editButton.title = '編集';
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener('click', () => {
        loadItemForEditing('customToken', token.id);
      });
      controlsDiv.appendChild(editButton);

      // --- 削除ボタン ---
      const deleteButton = document.createElement('button');
      deleteButton.className = 'list-button delete-item-button';
      deleteButton.title = '削除';
      deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
      deleteButton.addEventListener('click', async () => {
        if (!confirm(`トークン「${token.tokenName}」を削除しますか？`)) {
          return;
        }
        const newTokens = allCustomTokens.filter((_, i) => i !== index);
        const result = await window.myAPI.updateCustomTokens(newTokens);
        if (result.success) {
          showNotification('削除しました', false);
          refreshCustomTokensList(); // このリストを更新
          loadAndRenderCustomTokens(); // メインフォームとマイセットフォームも更新
        } else {
          showNotification('削除に失敗しました', true);
        }
      });
      controlsDiv.appendChild(deleteButton);
      
      li.appendChild(controlsDiv);
      listElement.appendChild(li);
    });

  } catch (err) {
    console.error('カスタムトークンリストの読み込み失敗:', err);
    listElement.innerHTML = '<li>リストの読み込みに失敗</li>';
  }
}


// --- 【★変更★】ヘルパー関数: 設定モーダル内の「マイセット」リスト更新 ---
async function refreshPresetsList() {
  const listElement = document.getElementById('presets-list');
  const listContainer = listElement.parentElement;
  const listType = 'preset';
  
  listElement.innerHTML = '<li>読み込み中...</li>';

  try {
    allPresets = await window.myAPI.getPresets();
    listElement.innerHTML = ''; // クリア

    if (allPresets.length === 0) {
      listElement.innerHTML = '<li>アイテムはありません</li>';
    }

    // --- 【★追加★】コンテナ（一番下）へのD&Dイベント ---
    listContainer.ondragover = (e) => {
      e.preventDefault();
      if (draggedListType === listType) {
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll(`#presets-list li`).forEach(li => {
          li.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        listContainer.classList.add('drag-over-container');
      }
    };
    listContainer.ondragleave = (e) => {
      e.preventDefault();
      listContainer.classList.remove('drag-over-container');
    };
    listContainer.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      listContainer.classList.remove('drag-over-container');
      
      if (draggedListType !== listType || !draggedItemId) return;

      const draggedIndex = allPresets.findIndex(item => item.id === draggedItemId);
      if (draggedIndex === -1 || draggedIndex === allPresets.length - 1) {
        draggedItemId = null;
        draggedListType = null;
        return;
      }
      
      const [draggedItem] = allPresets.splice(draggedIndex, 1);
      allPresets.push(draggedItem);
      
      const result = await window.myAPI.updatePresets(allPresets);
      if (result.success) {
        refreshPresetsList();
        populatePresetsDropdown();
      } else {
        showNotification('並び替えに失敗', true);
      }
      draggedItemId = null;
      draggedListType = null;
    };


    allPresets.forEach((preset, index) => {
      const li = document.createElement('li');
      
      // --- 【★変更★】D&Dイベント (li) ---
      li.draggable = true;
      li.dataset.itemId = preset.id; // dataset.presetId から汎用的な名前に

      li.addEventListener('dragstart', (e) => {
        draggedItemId = preset.id;
        draggedListType = listType;
        e.dataTransfer.setData('text/plain', preset.id);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => li.classList.add('dragging'), 0);
      });
      
      li.addEventListener('dragend', () => {
        clearAllDragHighlights();
        draggedItemId = null;
        draggedListType = null;
      });

      // ▼▼▼ 修正 ▼▼▼
      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation(); // ★★★ 修正: イベントの伝播を停止 ★★★

        if (draggedListType !== listType) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        if (draggedItemId === preset.id) {
          e.dataTransfer.dropEffect = 'none';
          return;
        }
        
        e.dataTransfer.dropEffect = 'move';
        const rect = li.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          li.classList.add('drag-over-top');
          li.classList.remove('drag-over-bottom');
        } else {
          li.classList.add('drag-over-bottom');
          li.classList.remove('drag-over-top');
        }
        listContainer.classList.remove('drag-over-container');
      });
      // ▲▲▲ 修正完了 ▲▲▲
      
      li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        
        if (draggedListType !== listType || !draggedItemId || draggedItemId === preset.id) {
          clearAllDragHighlights();
          return;
        }

        const draggedIndex = allPresets.findIndex(item => item.id === draggedItemId);
        let droppedIndex = allPresets.findIndex(item => item.id === preset.id);
        
        if (draggedIndex === -1 || droppedIndex === -1) return;

        const rect = li.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY > midY) {
          droppedIndex++; // 下半分にドロップ: インデックスを+1
        }
        
        const newItems = [...allPresets];
        const [draggedItem] = newItems.splice(draggedIndex, 1);
        if (draggedIndex < droppedIndex) droppedIndex--;
        newItems.splice(droppedIndex, 0, draggedItem);
        
        const result = await window.myAPI.updatePresets(newItems);
        if (result.success) {
          refreshPresetsList();
          populatePresetsDropdown();
        } else {
          showNotification('並び替えに失敗', true);
        }
        clearAllDragHighlights();
        draggedItemId = null;
        draggedListType = null;
      });
      // --- D&D (li) ここまで ---


      const contentDiv = document.createElement('div');
      contentDiv.className = 'item-content';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'preset-name';
      nameSpan.textContent = preset.setName;
      contentDiv.appendChild(nameSpan);

      const detailsSpan = document.createElement('span');
      detailsSpan.className = 'preset-details';
      detailsSpan.textContent = `Template: ${preset.template || '未設定'}`;
      contentDiv.appendChild(detailsSpan);
      
      li.appendChild(contentDiv);

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'item-controls';

      // --- 【★削除★】「上へ」「下へ」ボタンのロジックを削除 ---

      // --- 【★変更★】編集ボタン (順序変更) ---
      const editButton = document.createElement('button');
      editButton.className = 'list-button edit-item-button';
      editButton.title = '編集';
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener('click', () => {
        loadItemForEditing('preset', preset.id);
      });
      controlsDiv.appendChild(editButton);

      // --- 削除ボタン ---
      const deleteButton = document.createElement('button');
      deleteButton.className = 'list-button delete-item-button';
      deleteButton.title = '削除';
      deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
      deleteButton.addEventListener('click', async () => {
        if (!confirm(`マイセット「${preset.setName}」を削除しますか？`)) {
          return;
        }
        const newPresets = allPresets.filter((_, i) => i !== index);
        const result = await window.myAPI.updatePresets(newPresets);
        if (result.success) {
          showNotification('削除しました', false);
          refreshPresetsList();
          populatePresetsDropdown();
        } else {
          showNotification('削除に失敗しました', true);
        }
      });
      controlsDiv.appendChild(deleteButton);
      
      li.appendChild(controlsDiv);
      listElement.appendChild(li);
    });

  } catch (err) {
    console.error('マイセットリストの読み込み失敗:', err);
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
  presetSelect = document.getElementById('preset-select');
  filenamePreview = document.getElementById('filename-preview');
  groupCategory = document.getElementById('group-category');
  groupProject = document.getElementById('group-project');
  groupFreetext = document.getElementById('group-freetext');
  notification = document.getElementById('notification');
  customTokensContainer = document.getElementById('custom-tokens-container');

  // --- UI要素の取得 (設定モーダル - 主要なもの) ---
  const settingsModal = document.getElementById('settings-modal');
  const openSettingsButton = document.getElementById('open-settings-button');
  const closeSettingsButton = document.getElementById('close-settings-button');
  // (設定モーダル内の詳細な要素は、モーダルを開くときに取得・操作する)


  // --- メインフォームのドロップダウンを初期化 ---
  async function refreshMainDropdowns() {
    await Promise.all([
      populateDropdown('attr_category', window.myAPI.getCategories),
      populateDropdown('attr_project', window.myAPI.getProjects),
      populateDropdown('attr_extension', window.myAPI.getExtensions)
    ]);
    updateFormVisibility(activeNamingTemplate);
    updatePreview();
  }

  // --- 【変更】初期化処理 ---
  async function initializeApp() {
    // 1. カスタムトークンを読み込み、フォームを生成 (最優先)
    await loadAndRenderCustomTokens();
    
    // 2. メインのドロップダウンを初期化
    await refreshMainDropdowns();
    
    // 3. マイセットドロップダウンを初期化
    await populatePresetsDropdown();

    // 4. デフォルト設定を読み込み
    try {
      const config = await window.myAPI.getConfig();
      if (config.defaultSavePath) {
        saveDirText.value = config.defaultSavePath;
        selectedSaveDir = config.defaultSavePath;
      }
      defaultNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';
      activeNamingTemplate = defaultNamingTemplate;

      // 5. フォーム表示とプレビューを最終更新
      updateFormVisibility(activeNamingTemplate);
      updatePreview();

    } catch (err) {
      console.error('設定の読み込みに失敗', err);
      updateFormVisibility(activeNamingTemplate);
      updatePreview();
    }
  }
  
  initializeApp(); // アプリケーション初期化を実行


  // --- イベントリスナーの登録 ---

  // (1) メインフォーム: 「フォルダを選択」
  selectDirButton.addEventListener('click', async () => {
    const result = await window.myAPI.selectSaveDir();
    if (result.success) {
      saveDirText.value = result.path;
      selectedSaveDir = result.path;
      updatePreview();
    }
  });

  // (2) メインフォーム: 「ファイル作成」
  createButton.addEventListener('click', async () => {
    
    // ▼▼▼ 修正: ローディングボタン化 ▼▼▼
    const originalButtonText = createButton.textContent;
    createButton.disabled = true;
    createButton.textContent = '作成中...';
    // ▲▲▲ 修正完了 ▲▲▲

    const values = collectFormValues();
    const data = {
      saveDir: selectedSaveDir,
      extension: extensionSelect.value, // 【変更】フォームから拡張子を取得
      description: descriptionInput.value,
      template: activeNamingTemplate,
      values: values
    };

    try { // ▼▼▼ 修正: try...finally ▼▼▼
      const result = await window.myAPI.createFile(data);

      if (result.success) {
        showNotification(result.message, false);
        descriptionInput.value = ''; 
        freetextInput.value = ''; 
        // 【変更】カスタムトークン入力欄もクリア
        document.querySelectorAll('#custom-tokens-container .custom-token-input').forEach(input => {
          input.value = '';
        });
        
        updatePreview(); // 次のバージョンを表示
      } else {
        showNotification(result.message, true);
      }
    } catch (err) {
      console.error('Create file API error:', err);
      showNotification(`ファイル作成に失敗しました: ${err.message}`, true);
    } finally {
      // ▼▼▼ 修正: ボタンを元に戻す ▼▼▼
      createButton.disabled = false;
      createButton.textContent = originalButtonText;
      // ▲▲▲ 修正完了 ▲▲▲
    }
  });

  // (3) 設定モーダル: 「設定」ボタン (モーダルを開く)
  openSettingsButton.addEventListener('click', async () => {
      // --- 設定モーダル内のUI要素を取得 ---
      const authorInput = document.getElementById('author-input');
      const defaultPathInput = document.getElementById('default-path-input');
      const namingTemplateInput = document.getElementById('naming-template-input');
      const newCategoryInput = document.getElementById('new-category-input');
      const addCategoryButton = document.getElementById('add-category-button');
      const newProjectInput = document.getElementById('new-project-input');
      const addProjectButton = document.getElementById('add-project-button');
      const importSettingsButton = document.getElementById('import-settings-button');
      const exportSettingsButton = document.getElementById('export-settings-button');
      const browseDefaultPathButton = document.getElementById('browse-default-path-button');
      // カスタムトークン
      const newTokenName = document.getElementById('new-token-name');
      const newTokenLabel = document.getElementById('new-token-label');
      const addTokenButton = document.getElementById('add-token-button');
      // マイセット
      const newPresetName = document.getElementById('new-preset-name');
      const newPresetSaveDir = document.getElementById('new-preset-saveDir');
      const newPresetTemplate = document.getElementById('new-preset-template');
      const browsePresetSaveDirButton = document.getElementById('browse-preset-saveDir-button');
      const addPresetButton = document.getElementById('add-preset-button');
      const newPresetCategory = document.getElementById('new-preset-category');
      const newPresetProject = document.getElementById('new-preset-project');
      const newPresetExtension = document.getElementById('new-preset-extension'); // ★ 追加
      const newPresetFreetext = document.getElementById('new-preset-freetext');


      // --- モーダルを開くときの初期化処理 ---
      
      // 【追加】フォーム状態をリセット
      resetAddForms();

      try {
        // 1. config.json 読み込み
        const config = await window.myAPI.getConfig();
        authorInput.value = config.author || '';
        defaultPathInput.value = config.defaultSavePath || '';
        namingTemplateInput.value = config.namingTemplate || '{date}_{category}_{project}_{version}';
        
        // 2. グローバル変数をリセット
        defaultNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';
        activeNamingTemplate = defaultNamingTemplate;
        
        // 3. メインフォームのマイセット選択をリセット
        presetSelect.value = '';
        
      } catch (err) {
        showNotification('設定の読み込みに失敗', true);
      }
      
      // 4. カスタムトークンフォームを再生成 (最新の定義を読み込むため)
      await loadAndRenderCustomTokens();
      
      // 5. マイセットのプリセット用ドロップダウンを生成
      await populateDropdown('new-preset-category', window.myAPI.getCategories, true);
      await populateDropdown('new-preset-project', window.myAPI.getProjects, true);
      await populateDropdown('new-preset-extension', window.myAPI.getExtensions, true); // ★ 追加

      // 6. 全てのリストを更新
      refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
      refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
      refreshCustomTokensList(); // カスタムトークンリスト
      refreshPresetsList(); // マイセットリスト

      // 7. モーダルを表示
      settingsModal.style.display = 'flex';
      
      // 8. 【★ 修正 ★】モーダル表示後、最初の入力欄にフォーカスを当てる
      if (authorInput) {
        authorInput.focus();
      }
      
      // --- このモーダル内だけで完結するイベントリスナーを登録 ---
      // ※ closeButton などは外側のスコープで登録済

      // (5) 分類を追加
      addCategoryButton.onclick = async () => {
        const newItem = newCategoryInput.value.trim();
        if (!newItem) return showNotification('分類名を入力してください', true);
        
        let result;
        if (editingItemId && editingListType === 'category') {
          // --- 更新処理 ---
          if (newItem === editingItemId) { // 名前が変わっていない
            resetAddForms();
            return;
          }
          if (allCategories.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          
          const newItems = allCategories.map(item => (item === editingItemId ? newItem : item));
          result = await window.myAPI.updateCategories(newItems);

        } else {
          // --- 追加処理 ---
          if (allCategories.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          const newItems = [...allCategories, newItem];
          result = await window.myAPI.updateCategories(newItems);
        }

        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
          refreshMainDropdowns();
          populateDropdown('new-preset-category', window.myAPI.getCategories, true); // マイセット用も更新
        } else {
          showNotification(editingItemId ? '更新に失敗しました' : '追加に失敗しました', true);
        }
      };

      // (6) プロジェクトを追加
      addProjectButton.onclick = async () => {
        const newItem = newProjectInput.value.trim();
        if (!newItem) return showNotification('プロジェクト名を入力してください', true);

        let result;
        if (editingItemId && editingListType === 'project') {
          // --- 更新処理 ---
          if (newItem === editingItemId) {
            resetAddForms();
            return;
          }
          if (allProjects.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          
          const newItems = allProjects.map(item => (item === editingItemId ? newItem : item));
          result = await window.myAPI.updateProjects(newItems);

        } else {
          // --- 追加処理 ---
          if (allProjects.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          const newItems = [...allProjects, newItem];
          result = await window.myAPI.updateProjects(newItems);
        }

        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
          refreshMainDropdowns();
          populateDropdown('new-preset-project', window.myAPI.getProjects, true); // マイセット用も更新
        } else {
          showNotification(editingItemId ? '更新に失敗しました' : '追加に失敗しました', true);
        }
      };

      // (7) エクスポート
      exportSettingsButton.onclick = async () => {
        const result = await window.myAPI.exportSettings();
        showNotification(result.message, !result.success);
      };

      // (8) インポート
      importSettingsButton.onclick = async () => {
        if (!confirm('現在の設定は上書きされます。よろしいですか？')) return;
        
        const result = await window.myAPI.importSettings();
        showNotification(result.message, !result.success);
        
        if (result.success) {
          // インポート成功時、モーダル全体を再初期化
          resetAddForms(); // 編集状態をリセット
          openSettingsButton.click(); // 自身を再度クリックして全体をリロード
          // メインフォームもリロード
          initializeApp();
        }
      };

      // (9) デフォルトパス参照
      browseDefaultPathButton.onclick = async () => {
        const result = await window.myAPI.selectDefaultDir();
        if (result.success) defaultPathInput.value = result.path;
      };

      // (11) マイセット保存先参照
      browsePresetSaveDirButton.onclick = async () => {
        const result = await window.myAPI.selectDefaultDir();
        if (result.success) newPresetSaveDir.value = result.path;
      };

      // (12) マイセット追加
      addPresetButton.onclick = async () => {
        const setName = newPresetName.value.trim();
        const saveDir = newPresetSaveDir.value.trim();
        const template = newPresetTemplate.value.trim();

        if (!setName || !saveDir || !template) return showNotification('セット名、保存先、テンプレートは必須です', true);
        
        // {version} 必須チェックは削除済み
        
        // プリセット値の収集
        const presetValues = {
          category: newPresetCategory.value,
          project: newPresetProject.value,
          extension: newPresetExtension.value, // ★ 追加
          free_text: newPresetFreetext.value
        };

        // カスタムトークンのプリセット値も収集
        document.querySelectorAll('#new-preset-custom-tokens-container .new-preset-custom-input').forEach(input => {
          presetValues[input.dataset.tokenKey] = input.value;
        });

        let result;
        if (editingItemId && editingListType === 'preset') {
          // --- 更新処理 ---
          const updatedPreset = {
            id: editingItemId, // 既存のID
            setName: setName,
            saveDir: saveDir,
            template: template,
            presetValues: presetValues
          };
          const newPresets = allPresets.map(p => (p.id === editingItemId ? updatedPreset : p));
          result = await window.myAPI.updatePresets(newPresets);
        } else {
          // --- 追加処理 ---
          const newPreset = {
            id: Date.now().toString(),
            setName: setName,
            saveDir: saveDir,
            template: template,
            presetValues: presetValues 
          };
          const newPresets = [...allPresets, newPreset];
          result = await window.myAPI.updatePresets(newPresets);
        }

        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          // リストを更新
          refreshPresetsList();
          populatePresetsDropdown();
        } else {
          showNotification(editingItemId ? '更新に失敗しました' : '追加に失敗しました', true);
        }
      };
      
      // (13) カスタムトークン追加
      addTokenButton.onclick = async () => {
        const tokenName = newTokenName.value.trim();
        const tokenLabel = newTokenLabel.value.trim();
        
        if (!tokenName || !tokenLabel) return showNotification('トークン名とラベルの両方を入力してください', true);
        if (!tokenName.startsWith('{') || !tokenName.endsWith('}') || tokenName.length < 3) return showNotification('トークン名は {name} の形式で入力してください', true);
        
        let result;
        if (editingItemId && editingListType === 'customToken') {
          // --- 更新処理 ---
          const existingToken = allCustomTokens.find(t => t.id === editingItemId);
          // トークン名が変更されたかチェック
          if (existingToken.tokenName !== tokenName) {
            // 変更後の名前が他と重複していないかチェック
            if (allCustomTokens.some(t => t.tokenName === tokenName && t.id !== editingItemId)) {
              return showNotification('エラー: そのトークン名は既に使用されています', true);
            }
          }
          
          const updatedToken = { id: editingItemId, tokenName: tokenName, label: tokenLabel };
          const newTokens = allCustomTokens.map(t => (t.id === editingItemId ? updatedToken : t));
          result = await window.myAPI.updateCustomTokens(newTokens);
        
        } else {
          // --- 追加処理 ---
          if (allCustomTokens.some(t => t.tokenName === tokenName)) return showNotification('エラー: そのトークン名は既に使用されています', true);
          const newToken = {
            id: Date.now().toString(),
            tokenName: tokenName,
            label: tokenLabel
          };
          const newTokens = [...allCustomTokens, newToken];
          result = await window.myAPI.updateCustomTokens(newTokens);
        }
        
        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          refreshCustomTokensList(); // 設定リストを更新
          loadAndRenderCustomTokens(); // メインフォームとマイセットフォームを更新
        } else {
          showNotification(editingItemId ? '更新に失敗しました' : '追加に失敗しました', true);
        }
      };

  });

  // (4) 設定モーダル: 「閉じる」ボタン
  closeSettingsButton.addEventListener('click', async () => {
    const namingTemplateInput = document.getElementById('naming-template-input');
    const authorInput = document.getElementById('author-input');
    const defaultPathInput = document.getElementById('default-path-input');

    const template = namingTemplateInput.value.trim();
    
    try {
      const configToSave = {
        author: authorInput.value.trim(),
        defaultSavePath: defaultPathInput.value.trim(),
        namingTemplate: template 
      };
      await window.myAPI.updateConfig(configToSave); 
      
      defaultNamingTemplate = template;
      activeNamingTemplate = template; // アクティブなテンプレートもデフォルトに戻す

    } catch (err) {
      showNotification('設定の保存に失敗', true);
    }
    
    settingsModal.style.display = 'none';
    
    // 【追加】フォーム状態をリセット
    resetAddForms();
    
    // メインフォームの状態をリフレッシュ
    initializeApp();
  });


  // --- メインフォームの入力変更イベント ---

  // (10) プレビュー用のイベントリスナー (標準フォーム)
  categorySelect.addEventListener('change', updatePreview);
  projectSelect.addEventListener('change', updatePreview);
  extensionSelect.addEventListener('change', updatePreview);
  freetextInput.addEventListener('input', updatePreview);
  // (カスタムトークンフォームのリスナーは loadAndRenderCustomTokens 内で動的に追加)

  // (11) メインフォーム: 「マイセット」選択
  presetSelect.addEventListener('change', () => {
    const selectedId = presetSelect.value;
    const selectedPreset = allPresets.find(p => p.id === selectedId);

    if (selectedPreset) {
      // --- セットが選択された ---
      saveDirText.value = selectedPreset.saveDir;
      selectedSaveDir = selectedPreset.saveDir;
      activeNamingTemplate = selectedPreset.template;

      // --- プリセット値の自動入力 ---
      const values = selectedPreset.presetValues || {};
      
      // 標準トークン
      categorySelect.value = values.category || '';
      projectSelect.value = values.project || '';
      extensionSelect.value = values.extension || ''; // ★ 追加
      freetextInput.value = values.free_text || '';
      
      // カスタムトークン
      document.querySelectorAll('#custom-tokens-container .custom-token-input').forEach(input => {
        const key = input.dataset.tokenKey;
        input.value = values[key] || '';
      });

    } else {
      // --- 「選択なし」が選ばれた ---
      activeNamingTemplate = defaultNamingTemplate;
      // (フォームの値はリセットしない。手動で変更した可能性を考慮)
    }

    updateFormVisibility(activeNamingTemplate);
    updatePreview();
  });

});