import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';

export interface ChatMessage {
    role: string;
    content: string;
    timestamp: number;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    lastModified: number;
}

export class HistoryManager {
    private readonly STORAGE_KEY = 'ollama-chat-history';

    constructor(private readonly _context: vscode.ExtensionContext) { }

    public getSessions(): ChatSession[] {
        const sessions = this._context.globalState.get<ChatSession[]>(this.STORAGE_KEY, []);
        return sessions.sort((a, b) => b.lastModified - a.lastModified);
    }

    public getSession(id: string): ChatSession | undefined {
        const sessions = this.getSessions();
        return sessions.find(s => s.id === id);
    }

    public async saveSession(session: ChatSession): Promise<void> {
        let sessions = this.getSessions();
        const existingIndex = sessions.findIndex(s => s.id === session.id);

        if (existingIndex !== -1) {
            sessions[existingIndex] = session;
        } else {
            sessions.push(session);
        }

        await this._context.globalState.update(this.STORAGE_KEY, sessions);
    }

    public async createSession(title: string = 'New Chat'): Promise<ChatSession> {
        const newSession: ChatSession = {
            id: uuidv4(),
            title: title,
            messages: [],
            lastModified: Date.now()
        };
        await this.saveSession(newSession);
        return newSession;
    }

    public async deleteSession(id: string): Promise<void> {
        let sessions = this.getSessions();
        sessions = sessions.filter(s => s.id !== id);
        await this._context.globalState.update(this.STORAGE_KEY, sessions);
    }

    public async clearHistory(): Promise<void> {
        await this._context.globalState.update(this.STORAGE_KEY, []);
    }

    public updateSessionTitle(session: ChatSession): string {
        // Auto-generate title from first user message if logical
        const firstUserMsg = session.messages.find(m => m.role === 'user');
        if (firstUserMsg) {
            const title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
            return title;
        }
        return 'New Chat';
    }
}
