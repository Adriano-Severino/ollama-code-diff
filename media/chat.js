const vscode = acquireVsCodeApi();

const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const messagesDiv = document.getElementById('messages');
const modeSelect = document.getElementById('mode-select');
const modelSelect = document.getElementById('model-select');

sendButton.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

modeSelect.addEventListener('change', () => {
    vscode.postMessage({
        command: 'changeMode',
        mode: modeSelect.value
    });
});

modelSelect.addEventListener('change', () => {
    vscode.postMessage({
        command: 'changeModel',
        model: modelSelect.value
    });
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        vscode.postMessage({
            command: 'sendMessage',
            text: text,
            mode: modeSelect.value
        });
        chatInput.value = '';
    }
}

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'addMessage':
            addMessage(message.text, message.sender);
            break;
        case 'replaceLastMessage':
            replaceLastMessage(message.text, message.sender);
            break;
        case 'setModels':
            populateModelSelect(message.models);
            break;
        case 'setCurrentModel':
            modelSelect.value = message.modelName;
            break;
    }
});

function addMessage(text, sender) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender);
    messageElement.textContent = text;
    messagesDiv.appendChild(messageElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function replaceLastMessage(text, sender) {
    if (messagesDiv.lastChild) {
        messagesDiv.removeChild(messagesDiv.lastChild);
    }
    addMessage(text, sender);
}

function populateModelSelect(models) {
    modelSelect.innerHTML = '';
    models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = `${model.name} (${model.size})`;
        modelSelect.appendChild(option);
    });
}

// Solicitar modelos disponíveis quando o webview é carregado
vscode.postMessage({ command: 'getModels' });
