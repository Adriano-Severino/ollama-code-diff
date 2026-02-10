import * as vscode from 'vscode';

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export class Logger {
    private static channel: vscode.OutputChannel | null = null;
    private static verbose = false;

    public static init(context: vscode.ExtensionContext) {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('Ollama Code Diff');
            context.subscriptions.push(this.channel);
        }
        this.refreshConfig();
    }

    public static refreshConfig() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        this.verbose = config.get<boolean>('enableVerboseLogs', false);
    }

    public static info(message: string) {
        this.write('INFO', message);
    }

    public static warn(message: string, error?: unknown) {
        const details = this.formatError(error);
        const full = details ? `${message}\n${details}` : message;
        this.write('WARN', full);
    }

    public static error(message: string, error?: unknown) {
        const details = this.formatError(error);
        const full = details ? `${message}\n${details}` : message;
        this.write('ERROR', full);
    }

    public static debug(message: string) {
        if (!this.verbose) return;
        this.write('DEBUG', message);
    }

    private static write(level: LogLevel, message: string) {
        const timestamp = new Date().toISOString();
        this.channel?.appendLine(`[${timestamp}] [${level}] ${message}`);

        if (level === 'ERROR') {
            console.error(message);
        } else if (level === 'WARN') {
            console.warn(message);
        } else if (this.verbose) {
            console.log(message);
        }
    }

    private static formatError(error?: unknown): string {
        if (!error) return '';
        if (error instanceof Error) {
            if (error.stack) return error.stack;
            return `${error.name}: ${error.message}`;
        }
        return String(error);
    }
}
