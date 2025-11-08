// renderer.js

// --- グローバル変数 ---
let selectedSaveDir = null;
let defaultNamingTemplate = '{date}_{category}_{project}_{version}';
let activeNamingTemplate = '{date}_{category}_{project}_{version}';
let allPresets = [];
let allCustomTokens = []; 
let allCategories = [];
let allProjects = [];

let editingItemId = null;
let editingListType = null;

let draggedItemId = null;
let draggedListType = null;

// --- UI要素のキャッシュ (DOMContentLoadedで設定) ---
let saveDirText, categorySelect, projectSelect, extensionSelect, freetextInput, descriptionInput;
let filenamePreview, groupCategory, groupProject, groupFreetext;
let notification;
let presetSelect;
let customTokensContainer; 
let createButton; 
let settingsModal; // ★ セキュリティ: モーダル要素

// --- 通知表示用の関数 ---
let notificationTimer = null;
function showNotification(message, isError = false) {
  if (!notification) notification = document.getElementById('notification');
  // ★ 堅牢性: notification が null の場合をガード
  if (!notification) {
    console.error("Notification element not found. Message:", message);
    return;
  }
  if (notificationTimer) clearTimeout(notificationTimer);
  notification.textContent = message;
  notification.className = isError ? 'show error' : 'show';
  notificationTimer = setTimeout(() => {
    notification.className = isError ? 'error' : '';
  }, 3000);
}

/**
 * ★ 堅牢性: 【新規】UI要素の存在を検証するヘルパー
 * @param {Object<string, HTMLElement>} elements - { "要素名": 要素 } のオブジェクト
 */
function validateCriticalUIElements(elements) {
  const missingElements = [];
  for (const [name, element] of Object.entries(elements)) {
    if (!element) {
      missingElements.push(name);
    }
  }

  if (missingElements.length > 0) {
    const errorMsg = `致命的エラー: 必須UI要素が見つかりません: ${missingElements.join(', ')}. HTMLのid属性を確認してください。`;
    console.error(errorMsg);
    // ユーザーにもエラーを通知
    showNotification(errorMsg, true); 
    // これ以上実行するとクラッシュするため、ここで処理を中断
    throw new Error(errorMsg); 
  }
}

// --- ヘルパー関数: 分類・プロジェクトのドロップダウン生成 ---
async function populateDropdown(selectId, getItemsFunction, addEmptyOption = false) {
  const selectElement = document.getElementById(selectId);
  if (!selectElement) return;
  selectElement.innerHTML = ''; 
  
  if (addEmptyOption) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '（指定なし）';
    selectElement.appendChild(emptyOption);
  }

  try {
    const options = await getItemsFunction(); 
    
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
    presetSelect.innerHTML = ''; 
    
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

  if (!customTokensContainer) {
    customTokensContainer = document.getElementById('custom-tokens-container');
  }
  customTokensContainer.innerHTML = ''; 

  const newPresetCustomContainer = document.getElementById('new-preset-custom-tokens-container');
  if (newPresetCustomContainer) {
    newPresetCustomContainer.innerHTML = '';
  }

  allCustomTokens.forEach(token => {
    const key = token.tokenName.replace(/[{}]/g, '');

    // メインフォーム用
    const mainGroup = document.createElement('div');
    mainGroup.className = 'input-group';
    const mainLabel = document.createElement('label');
    mainLabel.htmlFor = `custom_token_${token.id}`;
    mainLabel.textContent = `${token.label}:`;
    mainGroup.appendChild(mainLabel);
    const mainInput = document.createElement('input');
    mainInput.type = 'text';
    mainInput.id = `custom_token_${token.id}`;
    mainInput.className = 'custom-token-input';
    mainInput.dataset.tokenKey = key;
    mainInput.placeholder = `(${token.tokenName} の値)`;
    mainInput.addEventListener('input', updatePreview); 
    mainGroup.appendChild(mainInput);
    customTokensContainer.appendChild(mainGroup);

    // 設定モーダル用
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
      presetInput.className = 'new-preset-custom-input';
      presetInput.dataset.tokenKey = key;
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

  document.getElementById('new-category-input').value = '';
  document.getElementById('new-project-input').value = '';
  document.getElementById('new-token-name').value = '';
  document.getElementById('new-token-label').value = '';
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
      buttonElement.innerHTML = '<i class="fas fa-plus"></i> このセットを追加';
    } else {
      buttonElement.textContent = '+';
    }
  }
  if (buttonElement.id === 'add-token-button') {
    buttonElement.innerHTML = mode === 'update' ? '<i class="fas fa-save"></i> このトークンを更新' : '<i class="fas fa-plus"></i> このトークンを追加';
  }
}

// --- 【新規】ヘルパー関数: アイテムを編集フォームに読み込む ---
function loadItemForEditing(listType, itemId) {
  editingItemId = itemId;
  editingListType = listType;
  resetAddForms();
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
  const customTokenElements = document.querySelectorAll('#custom-tokens-container .custom-token-input');
  customTokenElements.forEach(input => {
    const tokenKey = input.dataset.tokenKey;
    values[tokenKey] = input.value;
  });
  return values;
}


// --- 【変更】ヘルパー関数: プレビュー更新 ---
async function updatePreview() {
  if (!filenamePreview) return; 

  const isReady = selectedSaveDir && extensionSelect.value;
  
  if (createButton) {
    createButton.disabled = !isReady;
  }

  if (!isReady) {
    filenamePreview.textContent = '（保存場所とファイル形式を選択してください）';
    filenamePreview.classList.add('error');
    return;
  }

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

    // コンテナ（一番下）へのD&Dイベント
    listContainer.ondragover = (e) => {
      e.preventDefault();
      if (draggedListType === listType) {
        e.dataTransfer.dropEffect = 'move';
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
        draggedItemId = null;
        draggedListType = null;
        return;
      }
      
      const [draggedItem] = currentCache.splice(draggedIndex, 1);
      currentCache.push(draggedItem);
      
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
      
      // D&Dイベント (li)
      li.draggable = true;
      li.dataset.itemId = itemText; 

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

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation(); 
        
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
          droppedIndex++;
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
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'item-content';
      contentDiv.textContent = itemText;
      li.appendChild(contentDiv);

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'item-controls';

      // 編集ボタン
      const editButton = document.createElement('button');
      editButton.className = 'list-button edit-item-button';
      editButton.title = '編集';
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener('click', () => {
        loadItemForEditing(listType, itemText);
      });
      controlsDiv.appendChild(editButton);
      
      // 削除ボタン
      const deleteButton = document.createElement('button');
      deleteButton.className = 'list-button delete-item-button';
      deleteButton.title = '削除';
      deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
      
      deleteButton.addEventListener('click', async () => {
        // ★ セキュリティ: ネイティブダイアログに変更
        const confirmed = await window.myAPI.showConfirmationDialog(`「${itemText}」を削除しますか？`);
        if (!confirmed) {
          return;
        }
        const newItems = items.filter((_, i) => i !== index);
        const result = await updateItemsFunction(newItems);
        if (result.success) {
          showNotification('削除しました', false);
          refreshSettingsList(listId, getItemsFunction, updateItemsFunction);
          refreshMainDropdowns();
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
    listElement.innerHTML = ''; 

    if (allCustomTokens.length === 0) {
      listElement.innerHTML = '<li>アイテムはありません</li>';
    }

    // コンテナ（一番下）へのD&Dイベント
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
      
      // D&Dイベント (li)
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

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();

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
          droppedIndex++;
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
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'item-content';
      
      const nameSpan = document.createElement('span');
      nameSpan.className = 'token-name';
      nameSpan.textContent = token.tokenName;
      contentDiv.appendChild(nameSpan);

      const labelSpan = document.createElement('span');
      labelSpan.className = 'token-label';
      labelSpan.textContent = `Label: ${token.label}`;
      contentDiv.appendChild(labelSpan);
      
      li.appendChild(contentDiv);

      const controlsDiv = document.createElement('div');
      controlsDiv.className = 'item-controls';

      // 編集ボタン
      const editButton = document.createElement('button');
      editButton.className = 'list-button edit-item-button';
      editButton.title = '編集';
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener('click', () => {
        loadItemForEditing('customToken', token.id);
      });
      controlsDiv.appendChild(editButton);

      // 削除ボタン
      const deleteButton = document.createElement('button');
      deleteButton.className = 'list-button delete-item-button';
      deleteButton.title = '削除';
      deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
      deleteButton.addEventListener('click', async () => {
        // ★ セキュリティ: ネイティブダイアログに変更
        const confirmed = await window.myAPI.showConfirmationDialog(`トークン「${token.tokenName}」を削除しますか？`);
        if (!confirmed) {
          return;
        }
        const newTokens = allCustomTokens.filter((_, i) => i !== index);
        const result = await window.myAPI.updateCustomTokens(newTokens);
        if (result.success) {
          showNotification('削除しました', false);
          refreshCustomTokensList();
          loadAndRenderCustomTokens();
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
    listElement.innerHTML = '';

    if (allPresets.length === 0) {
      listElement.innerHTML = '<li>アイテムはありません</li>';
    }

    // コンテナ（一番下）へのD&Dイベント
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
      
      // D&Dイベント (li)
      li.draggable = true;
      li.dataset.itemId = preset.id; 

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

      li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation(); 

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
          droppedIndex++;
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

      // 編集ボタン
      const editButton = document.createElement('button');
      editButton.className = 'list-button edit-item-button';
      editButton.title = '編集';
      editButton.innerHTML = '<i class="fas fa-pencil-alt"></i>';
      editButton.addEventListener('click', () => {
        loadItemForEditing('preset', preset.id);
      });
      controlsDiv.appendChild(editButton);

      // 削除ボタン
      const deleteButton = document.createElement('button');
      deleteButton.className = 'list-button delete-item-button';
      deleteButton.title = '削除';
      deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
      deleteButton.addEventListener('click', async () => {
        // ★ セキュリティ: ネイティブダイアログに変更
        const confirmed = await window.myAPI.showConfirmationDialog(`マイセット「${preset.setName}」を削除しますか？`);
        if (!confirmed) {
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

// 最後に使用したプリセットIDを保存するヘルパー関数
async function saveLastUsedPreset(presetId) {
    try {
        const config = await window.myAPI.getConfig();
        config.lastUsedPresetId = presetId || '';
        await window.myAPI.updateConfig(config);
    } catch (err) {
        console.error('最後のプリセット保存に失敗:', err);
    }
}

// --- DOM（HTML）の読み込みが完了したら実行 ---
window.addEventListener('DOMContentLoaded', async () => {
  
  // --- UI要素の取得 (メインフォーム) ---
  createButton = document.getElementById('create-button');
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
  settingsModal = document.getElementById('settings-modal'); // ★ グローバルスコープに
  const openSettingsButton = document.getElementById('open-settings-button');
  const closeSettingsButton = document.getElementById('close-settings-button');

  // ★ 堅牢性: 必須UI要素の存在チェック
  try {
    validateCriticalUIElements({
      createButton, selectDirButton, saveDirText, categorySelect, projectSelect,
      extensionSelect, presetSelect, filenamePreview, notification,
      customTokensContainer, settingsModal, openSettingsButton, closeSettingsButton,
      groupCategory, groupProject, groupFreetext
    });
  } catch (err) {
    return; // 必須要素がないため、アプリを初期化しない
  }


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
    await loadAndRenderCustomTokens();
    await refreshMainDropdowns();
    await populatePresetsDropdown();

    try {
      const config = await window.myAPI.getConfig();
      if (config.defaultSavePath) {
        saveDirText.value = config.defaultSavePath;
        selectedSaveDir = config.defaultSavePath;
      }
      defaultNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';
      activeNamingTemplate = defaultNamingTemplate;
      
      if (config.lastUsedPresetId) {
          presetSelect.value = config.lastUsedPresetId;
          presetSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }

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
    
    const originalButtonHTML = createButton.innerHTML;
    createButton.disabled = true;
    createButton.innerHTML = '作成中...';

    const values = collectFormValues();
    const data = {
      saveDir: selectedSaveDir,
      extension: extensionSelect.value,
      description: descriptionInput.value,
      template: activeNamingTemplate,
      values: values
    };

    try {
      const result = await window.myAPI.createFile(data);

      if (result.success) {
        showNotification(result.message, false);
        descriptionInput.value = ''; 
        freetextInput.value = ''; 
        document.querySelectorAll('#custom-tokens-container .custom-token-input').forEach(input => {
          input.value = '';
        });
        saveLastUsedPreset(presetSelect.value);
        updatePreview();
      } else {
        showNotification(result.message, true);
      }
    } catch (err) {
      console.error('Create file API error:', err);
      showNotification(`ファイル作成に失敗しました: ${err.message}`, true);
    } finally {
      createButton.disabled = false;
      createButton.innerHTML = originalButtonHTML;
      updatePreview(); 
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
      const newTokenName = document.getElementById('new-token-name');
      const newTokenLabel = document.getElementById('new-token-label');
      const addTokenButton = document.getElementById('add-token-button');
      const newPresetName = document.getElementById('new-preset-name');
      const newPresetSaveDir = document.getElementById('new-preset-saveDir');
      const newPresetTemplate = document.getElementById('new-preset-template');
      const browsePresetSaveDirButton = document.getElementById('browse-preset-saveDir-button');
      const addPresetButton = document.getElementById('add-preset-button');
      const newPresetCategory = document.getElementById('new-preset-category');
      const newPresetProject = document.getElementById('new-preset-project');
      const newPresetExtension = document.getElementById('new-preset-extension');
      const newPresetFreetext = document.getElementById('new-preset-freetext');

      // --- モーダルを開くときの初期化処理 ---
      resetAddForms();

      try {
        const config = await window.myAPI.getConfig();
        authorInput.value = config.author || '';
        defaultPathInput.value = config.defaultSavePath || '';
        namingTemplateInput.value = config.namingTemplate || '{date}_{category}_{project}_{version}';
        defaultNamingTemplate = config.namingTemplate || '{date}_{category}_{project}_{version}';
      } catch (err) {
        showNotification('設定の読み込みに失敗', true);
      }
      
      await loadAndRenderCustomTokens();
      await populateDropdown('new-preset-category', window.myAPI.getCategories, true);
      await populateDropdown('new-preset-project', window.myAPI.getProjects, true);
      await populateDropdown('new-preset-extension', window.myAPI.getExtensions, true);
      refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
      refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
      refreshCustomTokensList();
      refreshPresetsList();

      // ★ セキュリティ: クラスで表示を切り替え
      settingsModal.classList.add('show');
      
      if (authorInput) {
        authorInput.focus();
      }
      
      // --- このモーダル内だけで完結するイベントリスナーを登録 ---

      // (5) 分類を追加
      addCategoryButton.onclick = async () => {
        const newItem = newCategoryInput.value.trim();
        if (!newItem) return showNotification('分類名を入力してください', true);
        
        let result;
        if (editingItemId && editingListType === 'category') {
          if (newItem === editingItemId) { resetAddForms(); return; }
          if (allCategories.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          const newItems = allCategories.map(item => (item === editingItemId ? newItem : item));
          result = await window.myAPI.updateCategories(newItems);
        } else {
          if (allCategories.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          const newItems = [...allCategories, newItem];
          result = await window.myAPI.updateCategories(newItems);
        }

        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          refreshSettingsList('categories-list', window.myAPI.getCategories, window.myAPI.updateCategories);
          refreshMainDropdowns();
          populateDropdown('new-preset-category', window.myAPI.getCategories, true);
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
          if (newItem === editingItemId) { resetAddForms(); return; }
          if (allProjects.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          const newItems = allProjects.map(item => (item === editingItemId ? newItem : item));
          result = await window.myAPI.updateProjects(newItems);
        } else {
          if (allProjects.includes(newItem)) return showNotification('エラー: その名前は既に使用されています', true);
          const newItems = [...allProjects, newItem];
          result = await window.myAPI.updateProjects(newItems);
        }

        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          refreshSettingsList('projects-list', window.myAPI.getProjects, window.myAPI.updateProjects);
          refreshMainDropdowns();
          populateDropdown('new-preset-project', window.myAPI.getProjects, true);
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
        // ★ セキュリティ: ネイティブダイアログに変更
        const confirmed = await window.myAPI.showConfirmationDialog('現在の設定は上書きされます。よろしいですか？');
        if (!confirmed) return;
        
        const result = await window.myAPI.importSettings();
        showNotification(result.message, !result.success);
        
        if (result.success) {
          resetAddForms();
          openSettingsButton.click(); 
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
        
        const presetValues = {
          category: newPresetCategory.value,
          project: newPresetProject.value,
          extension: newPresetExtension.value,
          free_text: newPresetFreetext.value
        };
        document.querySelectorAll('#new-preset-custom-tokens-container .new-preset-custom-input').forEach(input => {
          presetValues[input.dataset.tokenKey] = input.value;
        });

        let result;
        if (editingItemId && editingListType === 'preset') {
          const updatedPreset = { id: editingItemId, setName, saveDir, template, presetValues };
          const newPresets = allPresets.map(p => (p.id === editingItemId ? updatedPreset : p));
          result = await window.myAPI.updatePresets(newPresets);
        } else {
          const newPreset = { id: Date.now().toString(), setName, saveDir, template, presetValues };
          const newPresets = [...allPresets, newPreset];
          result = await window.myAPI.updatePresets(newPresets);
        }

        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
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
          const existingToken = allCustomTokens.find(t => t.id === editingItemId);
          if (existingToken.tokenName !== tokenName) {
            if (allCustomTokens.some(t => t.tokenName === tokenName && t.id !== editingItemId)) {
              return showNotification('エラー: そのトークン名は既に使用されています', true);
            }
          }
          const updatedToken = { id: editingItemId, tokenName, label: tokenLabel };
          const newTokens = allCustomTokens.map(t => (t.id === editingItemId ? updatedToken : t));
          result = await window.myAPI.updateCustomTokens(newTokens);
        } else {
          if (allCustomTokens.some(t => t.tokenName === tokenName)) return showNotification('エラー: そのトークン名は既に使用されています', true);
          const newToken = { id: Date.now().toString(), tokenName, label: tokenLabel };
          const newTokens = [...allCustomTokens, newToken];
          result = await window.myAPI.updateCustomTokens(newTokens);
        }
        
        if (result.success) {
          showNotification(editingItemId ? '更新しました' : '追加しました', false);
          resetAddForms();
          refreshCustomTokensList();
          loadAndRenderCustomTokens();
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
      // ★ 修正: 既存のconfigを読み込み、lastUsedPresetId を上書きしないようにする
      const config = await window.myAPI.getConfig(); 
      const configToSave = {
        ...config, // 既存の値 (lastUsedPresetIdを含む) を継承
        author: authorInput.value.trim(),
        defaultSavePath: defaultPathInput.value.trim(),
        namingTemplate: template
        // 'lastUsedPresetId: ""' の行を削除
      };
      await window.myAPI.updateConfig(configToSave); 
      defaultNamingTemplate = template;
    } catch (err) {
      showNotification('設定の保存に失敗', true);
    }
    
    // ★ セキュリティ: クラスで表示を切り替え
    settingsModal.classList.remove('show');
    
    resetAddForms();
    initializeApp();
  });


  // --- メインフォームの入力変更イベント ---
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
      saveDirText.value = selectedPreset.saveDir;
      selectedSaveDir = selectedPreset.saveDir;
      activeNamingTemplate = selectedPreset.template;

      const values = selectedPreset.presetValues || {};
      categorySelect.value = values.category || '';
      projectSelect.value = values.project || '';
      extensionSelect.value = values.extension || '';
      freetextInput.value = values.free_text || '';
      
      document.querySelectorAll('#custom-tokens-container .custom-token-input').forEach(input => {
        const key = input.dataset.tokenKey;
        input.value = values[key] || '';
      });
    } else {
      activeNamingTemplate = defaultNamingTemplate;
    }

    updateFormVisibility(activeNamingTemplate);
    updatePreview();
    saveLastUsedPreset(selectedId);
  });

});