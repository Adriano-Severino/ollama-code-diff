"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const vscode = __importStar(require("vscode"));
class Logger {
    static init(context) {
        if (!this.channel) {
            this.channel = vscode.window.createOutputChannel('Ollama Code Diff');
            context.subscriptions.push(this.channel);
        }
        this.refreshConfig();
    }
    static refreshConfig() {
        const config = vscode.workspace.getConfiguration('ollama-code-diff');
        this.verbose = config.get('enableVerboseLogs', false);
    }
    static info(message) {
        this.write('INFO', message);
    }
    static warn(message, error) {
        const details = this.formatError(error);
        const full = details ? `${message}\n${details}` : message;
        this.write('WARN', full);
    }
    static error(message, error) {
        const details = this.formatError(error);
        const full = details ? `${message}\n${details}` : message;
        this.write('ERROR', full);
    }
    static debug(message) {
        if (!this.verbose)
            return;
        this.write('DEBUG', message);
    }
    static write(level, message) {
        const timestamp = new Date().toISOString();
        this.channel?.appendLine(`[${timestamp}] [${level}] ${message}`);
        if (level === 'ERROR') {
            console.error(message);
        }
        else if (level === 'WARN') {
            console.warn(message);
        }
        else if (this.verbose) {
            console.log(message);
        }
    }
    static formatError(error) {
        if (!error)
            return '';
        if (error instanceof Error) {
            if (error.stack)
                return error.stack;
            return `${error.name}: ${error.message}`;
        }
        return String(error);
    }
}
exports.Logger = Logger;
Logger.channel = null;
Logger.verbose = false;
//# sourceMappingURL=logger.js.map