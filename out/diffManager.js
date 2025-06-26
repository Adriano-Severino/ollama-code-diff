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
exports.DiffManager = void 0;
const vscode = __importStar(require("vscode"));
class DiffManager {
    constructor() {
        this.lastDiffUris = null;
    }
    async showCodeDiff(editor, newCode, title, targetRange) {
        const document = editor.document;
        const originalContent = document.getText();
        let modifiedContent;
        if (targetRange) {
            // Substituir apenas a seleção
            const beforeSelection = document.getText(new vscode.Range(0, 0, targetRange.start.line, targetRange.start.character));
            const afterSelection = document.getText(new vscode.Range(targetRange.end.line, targetRange.end.character, document.lineCount, 0));
            modifiedContent = beforeSelection + newCode + afterSelection;
        }
        else {
            // Inserir na posição atual do cursor
            const position = editor.selection.active;
            const beforeCursor = document.getText(new vscode.Range(0, 0, position.line, position.character));
            const afterCursor = document.getText(new vscode.Range(position.line, position.character, document.lineCount, 0));
            modifiedContent = beforeCursor + '\n' + newCode + '\n' + afterCursor;
        }
        // Criar URIs temporários para o diff
        const originalUri = vscode.Uri.parse(`untitled:Original-${Date.now()}`);
        const modifiedUri = vscode.Uri.parse(`untitled:Modified-${Date.now()}`);
        // Salvar referências para uso posterior
        this.lastDiffUris = { original: originalUri, modified: modifiedUri };
        // Abrir documentos temporários
        await vscode.workspace.openTextDocument(originalUri).then(doc => {
            return vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
        });
        await vscode.workspace.openTextDocument(modifiedUri).then(doc => {
            return vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Two });
        });
        // Inserir conteúdo nos documentos
        const originalEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === originalUri.toString());
        const modifiedEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === modifiedUri.toString());
        if (originalEditor && modifiedEditor) {
            await originalEditor.edit(editBuilder => {
                editBuilder.insert(new vscode.Position(0, 0), originalContent);
            });
            await modifiedEditor.edit(editBuilder => {
                editBuilder.insert(new vscode.Position(0, 0), modifiedContent);
            });
            // Mostrar diff view
            await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, `${title}: Original ↔ Modificado`);
            // Mostrar opções para o usuário
            this.showDiffActions(editor, modifiedContent, targetRange);
        }
    }
    async showDiffActions(originalEditor, newContent, targetRange) {
        const action = await vscode.window.showInformationMessage('Código gerado. O que você gostaria de fazer?', 'Aplicar Mudanças', 'Copiar Código', 'Descartar');
        switch (action) {
            case 'Aplicar Mudanças':
                await this.applyChanges(originalEditor, newContent, targetRange);
                break;
            case 'Copiar Código':
                await vscode.env.clipboard.writeText(newContent);
                vscode.window.showInformationMessage('Código copiado para a área de transferência');
                break;
            case 'Descartar':
                // Não faz nada, mantém o código original
                break;
        }
    }
    async applyChanges(editor, newContent, targetRange) {
        await editor.edit(editBuilder => {
            if (targetRange) {
                editBuilder.replace(targetRange, newContent);
            }
            else {
                const position = editor.selection.active;
                editBuilder.insert(position, '\n' + newContent + '\n');
            }
        });
        vscode.window.showInformationMessage('Mudanças aplicadas com sucesso!');
    }
    async showLastDiff() {
        if (this.lastDiffUris) {
            await vscode.commands.executeCommand('vscode.diff', this.lastDiffUris.original, this.lastDiffUris.modified, 'Último Diff Gerado');
        }
        else {
            vscode.window.showInformationMessage('Nenhum diff anterior encontrado');
        }
    }
}
exports.DiffManager = DiffManager;
//# sourceMappingURL=diffManager.js.map