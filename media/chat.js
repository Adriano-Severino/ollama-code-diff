const vscode = acquireVsCodeApi();

const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const messagesDiv = document.getElementById('messages');
const modeSelect = document.getElementById('mode-select');
const modelSelect = document.getElementById('model-select');
const suggestionsDiv = document.getElementById('suggestions');
const pinButton = document.getElementById('pin-button');
const settingsButton = document.getElementById('settings-button');
const pinnedFilesDiv = document.getElementById('pinned-files');
const refreshModelsButton = document.getElementById('refresh-models');

const processingIndicator = document.getElementById('processing-indicator');
const processingTitle = document.getElementById('processing-title');
const processingSubtitle = document.getElementById('processing-subtitle');
const stopButton = document.getElementById('stop-button');

// History Elements
const newChatButton = document.getElementById('new-chat-button');
const historyButton = document.getElementById('history-button');
const historyOverlay = document.getElementById('history-overlay');
const closeHistoryButton = document.getElementById('close-history');
const historyList = document.getElementById('history-list');

const INPUT_PLACEHOLDER_BY_MODE = {
  chat: 'Pergunte algo ou digite /explain, /fix, /test, /refactor...',
  agent: 'Descreva uma tarefa para o Agent (planejar + executar)...',
  edit: 'Descreva a edicao em linguagem natural para gerar um patch aplicavel...',
  plan: 'Descreva um plano ou estrategia...'
};

let availableFiles = [];
let isProcessing = false;
let processingStartTime = null;
let elapsedTimeInterval = null;

// Markdown
if (typeof marked !== 'undefined') {
  marked.use({ gfm: true, breaks: true });
}

// Buttons
if (newChatButton) {
  newChatButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'newChat' });
    historyOverlay.classList.add('hidden');
  });
}

if (historyButton) {
  historyButton.addEventListener('click', () => {
    historyOverlay.classList.toggle('hidden');
    if (!historyOverlay.classList.contains('hidden')) {
      vscode.postMessage({ command: 'requestHistory' });
    }
  });
}

if (closeHistoryButton) {
  closeHistoryButton.addEventListener('click', () => {
    historyOverlay.classList.add('hidden');
  });
}

if (sendButton) sendButton.addEventListener('click', sendMessage);

if (pinButton) {
  pinButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'requestPinFile' });
  });
}

if (settingsButton) {
  settingsButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'openSettings' });
  });
}

if (refreshModelsButton) {
  refreshModelsButton.addEventListener('click', () => {
    vscode.postMessage({ command: 'requestModels' });
  });
}

if (stopButton) {
  stopButton.addEventListener('click', () => {
    cancelGeneration();
  });
}

// Escape key cancellation
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isProcessing) {
    e.preventDefault();
    cancelGeneration();
  }
});

function cancelGeneration() {
  if (!isProcessing) return;
  if (stopButton) stopButton.disabled = true;
  setProcessing(true, { subtitle: 'Cancelando…' });
  vscode.postMessage({ command: 'cancelGeneration' });
}

// Auto-resize textarea
if (chatInput) {
  chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
    if (this.value === '') this.style.height = 'auto';
  });

  // @ mentions
  chatInput.addEventListener('input', function () {
    const text = chatInput.value;
    const cursorPosition = chatInput.selectionStart;
    const lastAt = text.lastIndexOf('@', cursorPosition - 1);

    if (lastAt !== -1) {
      const query = text.substring(lastAt + 1, cursorPosition);
      if (!query.includes(' ')) {
        if (availableFiles.length === 0) vscode.postMessage({ command: 'requestFiles' });
        showSuggestions(query);
        return;
      }
    }
    hideSuggestions();
  });

  chatInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();

      if (suggestionsDiv.style.display === 'block') {
        const active = suggestionsDiv.querySelector('.suggestion-item.selected');
        if (active) selectSuggestion(active.textContent);
        else if (suggestionsDiv.firstChild) selectSuggestion(suggestionsDiv.firstChild.textContent);
      } else {
        sendMessage();
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (suggestionsDiv.style.display === 'block') {
        e.preventDefault();
        moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });
}

if (modeSelect) {
  modeSelect.addEventListener('change', () => {
    vscode.postMessage({ command: 'changeMode', mode: modeSelect.value });
    updateInputPlaceholder();
  });
}

if (modelSelect) {
  modelSelect.addEventListener('change', () => {
    vscode.postMessage({ command: 'setSelectedModel', modelName: modelSelect.value });
  });
}

function setProcessing(state, info = {}) {
  isProcessing = state;
  if (!processingIndicator) return;

  if (processingTitle && info.title) processingTitle.textContent = info.title;
  if (processingSubtitle && info.subtitle) processingSubtitle.textContent = info.subtitle;

  if (state) {
    processingIndicator.classList.remove('hidden');
    // UX melhor: deixa digitar, mas bloqueia envio
    if (sendButton) sendButton.disabled = true;
    if (stopButton) stopButton.disabled = false;

    // Start elapsed time tracking
    if (!processingStartTime) {
      processingStartTime = Date.now();
      updateElapsedTime();
      elapsedTimeInterval = setInterval(updateElapsedTime, 1000);
    }
  } else {
    processingIndicator.classList.add('hidden');
    if (sendButton) sendButton.disabled = false;
    if (stopButton) stopButton.disabled = true;
    if (chatInput) chatInput.focus();

    // Stop elapsed time tracking
    if (elapsedTimeInterval) {
      clearInterval(elapsedTimeInterval);
      elapsedTimeInterval = null;
    }
    processingStartTime = null;
  }
}

function updateElapsedTime() {
  if (!processingStartTime || !processingSubtitle) return;
  const elapsed = Math.floor((Date.now() - processingStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  const currentText = processingSubtitle.textContent.replace(/ \(\d+m? ?\d*s\)$/, '');
  processingSubtitle.textContent = `${currentText} (${timeStr})`;
}

function sendMessage() {
  if (!chatInput) return;
  const text = chatInput.value.trim();
  if (!text || isProcessing) return;

  setProcessing(true, { title: 'Processando…', subtitle: 'Enviando para o modelo…' });

  vscode.postMessage({
    command: 'sendMessage',
    text,
    mode: modeSelect ? modeSelect.value : 'chat'
  });

  chatInput.value = '';
  chatInput.style.height = 'auto';
}

function updateInputPlaceholder() {
  if (!chatInput || !modeSelect) return;
  chatInput.placeholder = INPUT_PLACEHOLDER_BY_MODE[modeSelect.value] || INPUT_PLACEHOLDER_BY_MODE.chat;
}

function showSuggestions(query) {
  const matches = availableFiles.filter(file => file.toLowerCase().includes(query.toLowerCase()));
  if (matches.length === 0) { hideSuggestions(); return; }

  suggestionsDiv.innerHTML = '';
  matches.slice(0, 10).forEach((file, index) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    if (index === 0) div.classList.add('selected');
    div.textContent = file;
    div.onclick = () => selectSuggestion(file);
    suggestionsDiv.appendChild(div);
  });

  suggestionsDiv.style.display = 'block';
}

function hideSuggestions() {
  suggestionsDiv.style.display = 'none';
}

function selectSuggestion(filename) {
  if (!chatInput) return;
  const text = chatInput.value;
  const cursorPosition = chatInput.selectionStart;
  const lastAt = text.lastIndexOf('@', cursorPosition - 1);

  if (lastAt !== -1) {
    const prefix = text.substring(0, lastAt);
    const suffix = text.substring(cursorPosition);
    chatInput.value = `${prefix}@${filename} ${suffix}`;
    chatInput.focus();
    hideSuggestions();
  }
}

function moveSelection(direction) {
  const current = suggestionsDiv.querySelector('.selected');
  const all = suggestionsDiv.querySelectorAll('.suggestion-item');
  if (!current) { if (all.length > 0) all[0].classList.add('selected'); return; }

  let index = Array.from(all).indexOf(current);
  index += direction;
  if (index >= 0 && index < all.length) {
    current.classList.remove('selected');
    all[index].classList.add('selected');
    all[index].scrollIntoView({ block: 'nearest' });
  }
}

function renderMessageContent(text) {
  if (typeof text !== 'string') return '';
  if (typeof marked !== 'undefined') {
    try { return marked.parse(text); }
    catch (e) { console.error('Markdown parse error:', e); return text; }
  }
  return text.replace(/\n/g, '<br>');
}

function renderAgentStep(step) {
  // step: { id, label, status: 'loading' | 'done' | 'error', details }
  const stepEl = document.createElement('div');
  stepEl.className = `agent-step ${step.status}`;

  const mainEl = document.createElement('div');
  mainEl.className = 'agent-step-main';

  const iconEl = document.createElement('div');
  iconEl.className = `step-icon ${step.status}`;
  if (step.status === 'loading') {
    iconEl.innerHTML = '<div class="spinner-small"></div>';
  } else if (step.status === 'done') {
    iconEl.innerHTML = '✓';
  } else if (step.status === 'error') {
    iconEl.innerHTML = '⚠';
  } else {
    iconEl.innerHTML = '○';
  }

  const labelEl = document.createElement('div');
  labelEl.className = 'step-label';
  labelEl.textContent = step.label;

  mainEl.appendChild(iconEl);
  mainEl.appendChild(labelEl);
  stepEl.appendChild(mainEl);

  if (step.details) {
    const detailsEl = document.createElement('div');
    detailsEl.className = 'step-details';
    detailsEl.textContent = step.details;
    stepEl.appendChild(detailsEl);
  }

  return stepEl;
}

function ensureAgentContainer(parent) {
  let container = parent.querySelector('.agent-process-container');
  if (!container) {
    parent.innerHTML = '';
    container = document.createElement('div');
    container.className = 'agent-process-container';

    const header = document.createElement('div');
    header.className = 'agent-process-header';
    header.innerHTML = '<span>Thinking Process</span><span class="step-count"></span>';
    header.onclick = () => {
      const steps = container.querySelector('.agent-process-steps');
      steps.style.display = steps.style.display === 'none' ? 'flex' : 'none';
    };

    const stepsDiv = document.createElement('div');
    stepsDiv.className = 'agent-process-steps';

    container.appendChild(header);
    container.appendChild(stepsDiv);
    parent.appendChild(container);
  }
  return container;
}

function addMessage(data, sender) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('message', sender);

  if (typeof data === 'string') {
    messageElement.innerHTML = renderMessageContent(data);
  } else if (data && data.type === 'agentProcess') {
    // Create the container and initial steps
    const container = ensureAgentContainer(messageElement);
    const stepsDiv = container.querySelector('.agent-process-steps');
    stepsDiv.innerHTML = '';
    (data.steps || []).forEach(step => stepsDiv.appendChild(renderAgentStep(step)));
    const stepCount = container.querySelector('.step-count');
    if (stepCount) {
      stepCount.textContent = `${(data.steps || []).filter(s => s.status === 'done').length}/${(data.steps || []).length}`;
    }
  } else {
    // Fallback: stringify unknown objects
    try {
      messageElement.innerHTML = renderMessageContent(JSON.stringify(data));
    } catch {
      messageElement.textContent = String(data);
    }
  }

  messagesDiv.appendChild(messageElement);
  scrollToBottom();
}

function replaceLastMessage(data, sender) {
  if (messagesDiv.lastElementChild) messagesDiv.removeChild(messagesDiv.lastElementChild);
  addMessage(data, sender);
}

function updateLastMessage(data, sender) {
  const lastMsg = messagesDiv.lastElementChild;
  if (lastMsg && lastMsg.classList.contains(sender)) {
    if (typeof data === 'string') {
      lastMsg.innerHTML = renderMessageContent(data);
    } else if (data && data.type === 'agentProcess') {
      const container = ensureAgentContainer(lastMsg);
      const stepsDiv = container.querySelector('.agent-process-steps');
      const stepCount = container.querySelector('.step-count');
      stepsDiv.innerHTML = '';
      (data.steps || []).forEach(step => stepsDiv.appendChild(renderAgentStep(step)));
      if (stepCount) {
        stepCount.textContent = `${(data.steps || []).filter(s => s.status === 'done').length}/${(data.steps || []).length}`;
      }
    } else {
      try {
        lastMsg.innerHTML = renderMessageContent(JSON.stringify(data));
      } catch {
        lastMsg.textContent = String(data);
      }
    }
    scrollToBottom();
  } else {
    addMessage(data, sender);
  }
}

function scrollToBottom() {
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function populateModelSelect(models) {
  modelSelect.innerHTML = '';
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.name;
    const label = model.name + (model.size ? ` (${model.size})` : '');
    option.textContent = label;
    modelSelect.appendChild(option);
  });
}

function renderPinnedFiles(files) {
  pinnedFilesDiv.innerHTML = '';
  files.forEach(file => {
    const tag = document.createElement('div');
    tag.className = 'pinned-file';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = file;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove';
    removeBtn.textContent = ' ✖';
    removeBtn.onclick = () => vscode.postMessage({ command: 'unpinFile', filePath: file });

    tag.appendChild(nameSpan);
    tag.appendChild(removeBtn);
    pinnedFilesDiv.appendChild(tag);
  });
}

function renderHistoryList(sessions) {
  historyList.innerHTML = '';
  sessions.forEach(session => {
    const div = document.createElement('div');
    div.className = 'history-item';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    titleSpan.textContent = session.title;
    titleSpan.onclick = () => {
      vscode.postMessage({ command: 'loadSession', sessionId: session.id });
      historyOverlay.classList.add('hidden');
    };

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      if (confirm('Delete this chat?')) {
        vscode.postMessage({ command: 'deleteSession', sessionId: session.id });
      }
    };

    div.appendChild(titleSpan);
    div.appendChild(deleteBtn);
    historyList.appendChild(div);
  });
}

// Messages from extension
window.addEventListener('message', event => {
  const message = event.data;

  switch (message.type) {
    case 'generationStart':
      setProcessing(true, {
        title: message.title || 'Processando…',
        subtitle: message.subtitle || 'Gerando resposta…'
      });
      if (stopButton) stopButton.disabled = false;
      break;

    case 'generationStatus':
      setProcessing(true, {
        subtitle: message.subtitle || 'Processando…'
      });
      break;

    case 'generationEnd':
      setProcessing(false);
      break;

    case 'generationCancelled':
      setProcessing(false);
      break;

    case 'availableModels':
      populateModelSelect(message.models);
      break;

    case 'currentModel':
      if (modelSelect) modelSelect.value = message.modelName;
      break;

    case 'fileList':
      availableFiles = message.files;
      break;

    case 'updatePinnedFiles':
      renderPinnedFiles(message.files);
      break;

    case 'clearChat':
      messagesDiv.innerHTML = '';
      break;

    case 'historyList':
      renderHistoryList(message.sessions);
      break;

    case 'addMessage':
      addMessage(message.text, message.sender);
      break;

    case 'replaceLastMessage':
      replaceLastMessage(message.text, message.sender);
      break;

    case 'updateLastMessage':
      updateLastMessage(message.text, message.sender);
      break;

    default:
      break;
  }
});

// Initial requests
vscode.postMessage({ command: 'requestModels' });
vscode.postMessage({ command: 'requestCurrentModel' });
updateInputPlaceholder();
