"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HistoryManager = void 0;
const uuid_1 = require("uuid");
class HistoryManager {
    constructor(_context) {
        this._context = _context;
        this.STORAGE_KEY = 'ollama-chat-history';
    }
    getSessions() {
        const sessions = this._context.globalState.get(this.STORAGE_KEY, []);
        return sessions.sort((a, b) => b.lastModified - a.lastModified);
    }
    getSession(id) {
        const sessions = this.getSessions();
        return sessions.find(s => s.id === id);
    }
    async saveSession(session) {
        let sessions = this.getSessions();
        const existingIndex = sessions.findIndex(s => s.id === session.id);
        if (existingIndex !== -1) {
            sessions[existingIndex] = session;
        }
        else {
            sessions.push(session);
        }
        await this._context.globalState.update(this.STORAGE_KEY, sessions);
    }
    async createSession(title = 'New Chat') {
        const newSession = {
            id: (0, uuid_1.v4)(),
            title: title,
            messages: [],
            lastModified: Date.now()
        };
        await this.saveSession(newSession);
        return newSession;
    }
    async deleteSession(id) {
        let sessions = this.getSessions();
        sessions = sessions.filter(s => s.id !== id);
        await this._context.globalState.update(this.STORAGE_KEY, sessions);
    }
    async clearHistory() {
        await this._context.globalState.update(this.STORAGE_KEY, []);
    }
    updateSessionTitle(session) {
        // Auto-generate title from first user message if logical
        const firstUserMsg = session.messages.find(m => m.role === 'user');
        if (firstUserMsg) {
            const title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
            return title;
        }
        return 'New Chat';
    }
}
exports.HistoryManager = HistoryManager;
//# sourceMappingURL=historyManager.js.map