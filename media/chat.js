const vscode = acquireVsCodeApi();

const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const messagesDiv = document.getElementById('messages');

sendButton.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage() {
    const text = chatInput.value.trim();
    if (text) {
        vscode.postMessage({
            command: 'sendMessage',
            text: text
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
