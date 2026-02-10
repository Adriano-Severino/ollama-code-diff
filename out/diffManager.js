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
exports.DiffManager = exports.DiffContentProvider = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const unifiedDiff_1 = require("./utils/unifiedDiff");
const MAX_UNDO_STACK_SIZE = 20;
class DiffContentProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChange = this._onDidChange.event;
        this.contents = new Map();
    }
    update(uri, content) {
        this.contents.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }
    provideTextDocumentContent(uri) {
        return this.contents.get(uri.toString()) || '';
    }
}
exports.DiffContentProvider = DiffContentProvider;
DiffContentProvider.scheme = 'ollama-diff';
class DiffManager {
    constructor() {
        this.lastDiffUris = null;
        this.lastMultiFilePreviews = [];
        this.undoStack = [];
        this.provider = new DiffContentProvider();
        vscode.workspace.registerTextDocumentContentProvider(DiffContentProvider.scheme, this.provider);
    }
    async showCodeDiff(editor, newCode, title, targetRange) {
        const document = editor.document;
        const originalContent = document.getText();
        const modifiedContent = this.buildModifiedContent(editor, originalContent, newCode, targetRange);
        const timestamp = Date.now();
        const originalUri = vscode.Uri.parse(`${DiffContentProvider.scheme}:single-original-${timestamp}`);
        const modifiedUri = vscode.Uri.parse(`${DiffContentProvider.scheme}:single-modified-${timestamp}`);
        this.provider.update(originalUri, originalContent);
        this.provider.update(modifiedUri, modifiedContent);
        this.lastDiffUris = { original: originalUri, modified: modifiedUri };
        this.lastMultiFilePreviews = [];
        await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, `${title}: Original ↔ Modificado`);
        await this.showDiffActions(editor, modifiedContent, title);
    }
    async previewAndApplyUnifiedDiff(diffContent, title = 'Patch Multi-Arquivo') {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return {
                applied: false,
                changedFiles: 0,
                message: 'Nenhum workspace aberto para aplicar o diff.'
            };
        }
        let parsedFiles;
        try {
            parsedFiles = (0, unifiedDiff_1.parseUnifiedDiff)(diffContent);
        }
        catch (error) {
            return {
                applied: false,
                changedFiles: 0,
                message: `Diff inválido: ${error instanceof Error ? error.message : String(error)}`
            };
        }
        let changes;
        try {
            changes = await this.buildFileChanges(parsedFiles, workspaceFolder);
        }
        catch (error) {
            return {
                applied: false,
                changedFiles: 0,
                message: `Falha ao preparar diff: ${error instanceof Error ? error.message : String(error)}`
            };
        }
        if (changes.length === 0) {
            return {
                applied: false,
                changedFiles: 0,
                message: 'O diff não contém mudanças aplicáveis.'
            };
        }
        const previews = this.createPreviewEntries(changes);
        this.lastMultiFilePreviews = previews;
        this.lastDiffUris = { original: previews[0].originalUri, modified: previews[0].modifiedUri };
        const shouldApply = await this.reviewPreviewBeforeApply(previews, title);
        if (!shouldApply) {
            return {
                applied: false,
                changedFiles: changes.length,
                message: 'Aplicação cancelada pelo usuário.'
            };
        }
        return this.applyFileChanges(changes, title);
    }
    async undoLastAppliedChanges() {
        const latestBatch = this.undoStack[this.undoStack.length - 1];
        if (!latestBatch) {
            const message = 'Nenhuma alteração aplicada para desfazer.';
            vscode.window.showInformationMessage(message);
            return message;
        }
        const conflicts = await this.collectConflicts(latestBatch.files, 'after');
        if (conflicts.length > 0) {
            const action = await vscode.window.showWarningMessage(`${conflicts.length} arquivo(s) mudaram após a aplicação: ${conflicts.slice(0, 3).join(', ')}` +
                `${conflicts.length > 3 ? ', ...' : ''}`, 'Forçar Undo', 'Cancelar');
            if (action !== 'Forçar Undo') {
                return 'Undo cancelado.';
            }
        }
        const edit = new vscode.WorkspaceEdit();
        for (const file of latestBatch.files) {
            if (!file.existedBefore) {
                edit.deleteFile(file.uri, { ignoreIfNotExists: true });
                continue;
            }
            if (!file.existedAfter) {
                edit.createFile(file.uri, { overwrite: true });
                if (file.beforeContent.length > 0) {
                    edit.insert(file.uri, new vscode.Position(0, 0), file.beforeContent);
                }
                continue;
            }
            let document;
            try {
                document = await vscode.workspace.openTextDocument(file.uri);
            }
            catch (error) {
                if (this.isFileNotFoundError(error)) {
                    edit.createFile(file.uri, { overwrite: true });
                    if (file.beforeContent.length > 0) {
                        edit.insert(file.uri, new vscode.Position(0, 0), file.beforeContent);
                    }
                    continue;
                }
                throw error;
            }
            edit.replace(file.uri, this.fullDocumentRange(document), file.beforeContent);
        }
        const undone = await vscode.workspace.applyEdit(edit);
        if (!undone) {
            const message = 'Falha ao desfazer alterações.';
            vscode.window.showErrorMessage(message);
            return message;
        }
        this.undoStack.pop();
        const message = `Alterações desfeitas: ${latestBatch.files.length} arquivo(s).`;
        vscode.window.showInformationMessage(message);
        return message;
    }
    async showDiffActions(originalEditor, newDocumentContent, title) {
        const action = await vscode.window.showInformationMessage('Código gerado. O que você gostaria de fazer?', 'Aplicar Mudanças', 'Copiar Código', 'Descartar');
        switch (action) {
            case 'Aplicar Mudanças':
                await this.applySingleDocumentContent(originalEditor, newDocumentContent, title);
                break;
            case 'Copiar Código':
                await vscode.env.clipboard.writeText(newDocumentContent);
                vscode.window.showInformationMessage('Código copiado para a área de transferência.');
                break;
            case 'Descartar':
                break;
        }
    }
    buildModifiedContent(editor, originalContent, newCode, targetRange) {
        if (targetRange) {
            const startOffset = editor.document.offsetAt(targetRange.start);
            const endOffset = editor.document.offsetAt(targetRange.end);
            return originalContent.slice(0, startOffset) + newCode + originalContent.slice(endOffset);
        }
        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        return `${originalContent.slice(0, cursorOffset)}\n${newCode}\n${originalContent.slice(cursorOffset)}`;
    }
    async applySingleDocumentContent(editor, newDocumentContent, title) {
        const beforeContent = editor.document.getText();
        const documentUri = editor.document.uri;
        const applied = await editor.edit(editBuilder => {
            editBuilder.replace(this.fullDocumentRange(editor.document), newDocumentContent);
        });
        if (!applied) {
            vscode.window.showErrorMessage('Não foi possível aplicar as mudanças no editor.');
            return;
        }
        if (documentUri.scheme === 'file') {
            const relativePath = vscode.workspace.asRelativePath(documentUri, false);
            this.pushUndoBatch({
                title,
                createdAt: Date.now(),
                files: [{
                        uri: documentUri,
                        relativePath,
                        beforeContent,
                        afterContent: newDocumentContent,
                        existedBefore: true,
                        existedAfter: true
                    }]
            });
            const undoAction = await vscode.window.showInformationMessage('Mudanças aplicadas com sucesso!', 'Desfazer');
            if (undoAction === 'Desfazer') {
                await this.undoLastAppliedChanges();
            }
            return;
        }
        vscode.window.showInformationMessage('Mudanças aplicadas com sucesso!');
    }
    async buildFileChanges(parsedFiles, workspaceFolder) {
        const changeMap = new Map();
        for (const filePatch of parsedFiles) {
            if (filePatch.oldPath &&
                filePatch.newPath &&
                filePatch.oldPath !== filePatch.newPath &&
                !filePatch.isNewFile &&
                !filePatch.isDeletedFile) {
                throw new Error(`Patch com rename ainda não suportado: ${filePatch.oldPath} -> ${filePatch.newPath}.`);
            }
            const rawTargetPath = filePatch.isDeletedFile ? filePatch.oldPath : filePatch.newPath || filePatch.oldPath;
            if (!rawTargetPath || rawTargetPath === '/dev/null') {
                continue;
            }
            const relativePath = this.normalizeRelativePath(rawTargetPath);
            const uri = vscode.Uri.joinPath(workspaceFolder.uri, ...relativePath.split('/'));
            const existingChange = changeMap.get(relativePath);
            let existedBefore;
            let beforeContent;
            let currentBaseContent;
            if (existingChange) {
                existedBefore = existingChange.existedBefore;
                beforeContent = existingChange.beforeContent;
                currentBaseContent = existingChange.afterContent;
            }
            else {
                const currentFile = await this.readWorkspaceText(uri);
                existedBefore = currentFile.exists;
                beforeContent = currentFile.content;
                currentBaseContent = currentFile.content;
            }
            if (filePatch.isNewFile && !existingChange && existedBefore) {
                throw new Error(`O arquivo "${relativePath}" já existe, mas o patch tenta criá-lo.`);
            }
            if (!filePatch.isNewFile && !filePatch.isDeletedFile && !existingChange && !existedBefore) {
                throw new Error(`O arquivo "${relativePath}" não existe para aplicar o patch.`);
            }
            const existedAfter = !filePatch.isDeletedFile;
            const afterContent = existedAfter ? (0, unifiedDiff_1.applyUnifiedDiffToContent)(currentBaseContent, filePatch) : '';
            changeMap.set(relativePath, {
                uri,
                relativePath,
                beforeContent,
                afterContent,
                existedBefore,
                existedAfter
            });
        }
        return Array.from(changeMap.values()).filter((change) => {
            if (change.existedBefore !== change.existedAfter) {
                return true;
            }
            return change.beforeContent !== change.afterContent;
        });
    }
    createPreviewEntries(changes) {
        const timestamp = Date.now();
        return changes.map((change, index) => {
            const safePath = encodeURIComponent(change.relativePath);
            const originalUri = vscode.Uri.parse(`${DiffContentProvider.scheme}:multi-${timestamp}-${index}-original-${safePath}`);
            const modifiedUri = vscode.Uri.parse(`${DiffContentProvider.scheme}:multi-${timestamp}-${index}-modified-${safePath}`);
            this.provider.update(originalUri, change.beforeContent);
            this.provider.update(modifiedUri, change.afterContent);
            return {
                relativePath: change.relativePath,
                originalUri,
                modifiedUri
            };
        });
    }
    async reviewPreviewBeforeApply(previews, title) {
        let currentIndex = 0;
        await this.openPreview(previews[currentIndex], title, currentIndex + 1, previews.length);
        while (true) {
            const items = [
                {
                    label: '$(check) Aplicar alterações',
                    description: `${previews.length} arquivo(s)`,
                    action: 'apply'
                },
                {
                    label: '$(close) Cancelar',
                    description: 'Não aplicar o patch',
                    action: 'cancel'
                },
                ...previews.map((entry, index) => ({
                    label: `${index === currentIndex ? '$(eye)' : '$(file-code)'} ${entry.relativePath}`,
                    description: index === currentIndex ? 'Preview aberto' : 'Abrir preview',
                    action: 'open',
                    fileIndex: index
                }))
            ];
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Revise os diffs antes de aplicar',
                matchOnDescription: true,
                ignoreFocusOut: true
            });
            if (!selected || selected.action === 'cancel') {
                return false;
            }
            if (selected.action === 'apply') {
                return true;
            }
            if (selected.action === 'open' && selected.fileIndex !== undefined) {
                currentIndex = selected.fileIndex;
                await this.openPreview(previews[currentIndex], title, currentIndex + 1, previews.length);
            }
        }
    }
    async openPreview(preview, title, index, total) {
        await vscode.commands.executeCommand('vscode.diff', preview.originalUri, preview.modifiedUri, `${title} (${index}/${total}): ${preview.relativePath}`);
    }
    async applyFileChanges(changes, title) {
        const conflicts = await this.collectConflicts(changes, 'before');
        if (conflicts.length > 0) {
            const action = await vscode.window.showWarningMessage(`${conflicts.length} arquivo(s) mudaram desde o preview: ${conflicts.slice(0, 3).join(', ')}` +
                `${conflicts.length > 3 ? ', ...' : ''}`, 'Forçar Aplicação', 'Cancelar');
            if (action !== 'Forçar Aplicação') {
                return {
                    applied: false,
                    changedFiles: changes.length,
                    message: 'Aplicação cancelada para evitar sobrescritas inesperadas.'
                };
            }
        }
        const edit = new vscode.WorkspaceEdit();
        for (const change of changes) {
            if (!change.existedBefore && change.existedAfter) {
                edit.createFile(change.uri, { overwrite: true });
                if (change.afterContent.length > 0) {
                    edit.insert(change.uri, new vscode.Position(0, 0), change.afterContent);
                }
                continue;
            }
            if (change.existedBefore && !change.existedAfter) {
                edit.deleteFile(change.uri, { ignoreIfNotExists: true });
                continue;
            }
            if (change.existedAfter) {
                const document = await vscode.workspace.openTextDocument(change.uri);
                edit.replace(change.uri, this.fullDocumentRange(document), change.afterContent);
            }
        }
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
            return {
                applied: false,
                changedFiles: changes.length,
                message: 'Falha ao aplicar as mudanças no workspace.'
            };
        }
        this.pushUndoBatch({
            title,
            createdAt: Date.now(),
            files: changes
        });
        const undoAction = await vscode.window.showInformationMessage(`Patch aplicado em ${changes.length} arquivo(s).`, 'Desfazer');
        if (undoAction === 'Desfazer') {
            await this.undoLastAppliedChanges();
            return {
                applied: true,
                changedFiles: changes.length,
                message: `Patch aplicado e desfeito em ${changes.length} arquivo(s).`
            };
        }
        return {
            applied: true,
            changedFiles: changes.length,
            message: `Patch aplicado com sucesso em ${changes.length} arquivo(s).`
        };
    }
    async collectConflicts(changes, snapshot) {
        const conflicts = [];
        for (const change of changes) {
            const expectedExists = snapshot === 'before' ? change.existedBefore : change.existedAfter;
            const expectedContent = snapshot === 'before' ? change.beforeContent : change.afterContent;
            const currentState = await this.readWorkspaceText(change.uri);
            if (currentState.exists !== expectedExists) {
                conflicts.push(change.relativePath);
                continue;
            }
            if (expectedExists && currentState.content !== expectedContent) {
                conflicts.push(change.relativePath);
            }
        }
        return conflicts;
    }
    async readWorkspaceText(uri) {
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            return {
                exists: true,
                content: new TextDecoder('utf-8').decode(bytes)
            };
        }
        catch (error) {
            if (this.isFileNotFoundError(error)) {
                return { exists: false, content: '' };
            }
            throw error;
        }
    }
    isFileNotFoundError(error) {
        const message = error instanceof Error ? error.message : String(error);
        return /EntryNotFound|FileNotFound|ENOENT/i.test(message);
    }
    normalizeRelativePath(relativePath) {
        const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
        if (!normalized || normalized === '.' || normalized === '/dev/null') {
            throw new Error(`Caminho inválido no patch: "${relativePath}".`);
        }
        if (path.posix.isAbsolute(normalized) || normalized.startsWith('../') || normalized === '..') {
            throw new Error(`Patch contém caminho fora do workspace: "${relativePath}".`);
        }
        return normalized;
    }
    fullDocumentRange(document) {
        return new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length));
    }
    pushUndoBatch(batch) {
        this.undoStack.push(batch);
        if (this.undoStack.length > MAX_UNDO_STACK_SIZE) {
            this.undoStack.shift();
        }
    }
    async showLastDiff() {
        if (this.lastMultiFilePreviews.length > 0) {
            const items = this.lastMultiFilePreviews.map((preview, index) => ({
                label: preview.relativePath,
                description: `Arquivo ${index + 1} de ${this.lastMultiFilePreviews.length}`,
                index
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Selecione o arquivo para abrir o último preview de diff'
            });
            if (selected) {
                const preview = this.lastMultiFilePreviews[selected.index];
                await this.openPreview(preview, 'Último Diff Multi-Arquivo', selected.index + 1, this.lastMultiFilePreviews.length);
            }
            return;
        }
        if (this.lastDiffUris) {
            await vscode.commands.executeCommand('vscode.diff', this.lastDiffUris.original, this.lastDiffUris.modified, 'Último Diff Gerado');
        }
        else {
            vscode.window.showInformationMessage('Nenhum diff anterior encontrado.');
        }
    }
}
exports.DiffManager = DiffManager;
//# sourceMappingURL=diffManager.js.map