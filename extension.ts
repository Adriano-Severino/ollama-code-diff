import * as vscode from 'vscode';

const OLLAMA_API_URL = 'http://localhost:11434/api';

export function activate(context: vscode.ExtensionContext) {
    
    // Comandos principais
    context.subscriptions.push(
        vscode.commands.registerCommand('ollama.run', async (command: string, args?: any[]) => {
            const res = await fetch(`${OLLAMA_API_URL}/run`, {
                method: 'POST',
                body: JSON.stringify({ command, args })
            });
            return await res.json();
        }),
        
        vscode.commands.registerCommand('ollama.read', async (filePath: string) => {
            const res = await fetch(`${OLLAMA_API_URL}/read`, {
                method: 'POST',
                body: JSON.stringify({ filePath })
            });
            return await res.text();
        }),
        
        vscode.commands.registerCommand('ollama.generateCode', async (prompt: string) => {
            const res = await fetch(`${OLLAMA_API_URL}/generate`, {
                method: 'POST',
                body: JSON.stringify({ prompt })
            });
            return await res.text();
        }),
        
        vscode.commands.registerCommand('ollama.analyzeFile', async (filePath: string, instruction: string) => {
            const res = await fetch(`${OLLAMA_API_URL}/analyze`, {
                method: 'POST',
                body: JSON.stringify({ filePath, instruction })
            });
            return await res.text();
        })
    );
}

export function deactivate() {}
