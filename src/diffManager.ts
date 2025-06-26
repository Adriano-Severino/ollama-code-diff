import * as vscode from 'vscode';
import * as path from 'path';

export class DiffManager {
    private lastDiffUris: { original: vscode.Uri; modified: vscode.Uri } | null = null;

    async showCodeDiff(
        editor: vscode.TextEditor, 
        newCode: string, 
        title: string,
        targetRange?: vscode.Range
    ): Promise<void> {
        const document = editor.document;
        const originalContent = document.getText();
        
        let modifiedContent: string;
        
        if (targetRange) {
            // Substituir apenas a seleção
            const beforeSelection = document.getText(new vscode.Range(0, 0, targetRange.start.line, targetRange.start.character));
            const afterSelection = document.getText(new vscode.Range(targetRange.end.line, targetRange.end.character, document.lineCount, 0));
            modifiedContent = beforeSelection + newCode + afterSelection;
        } else {
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
            await vscode.commands.executeCommand(
                'vscode.diff',
                originalUri,
                modifiedUri,
                `${title}: Original ↔ Modificado`
            );

            // Mostrar opções para o usuário
            this.showDiffActions(editor, modifiedContent, targetRange);
        }
    }

    private async showDiffActions(
        originalEditor: vscode.TextEditor, 
        newContent: string, 
        targetRange?: vscode.Range
    ): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            'Código gerado. O que você gostaria de fazer?',
            'Aplicar Mudanças',
            'Copiar Código',
            'Descartar'
        );

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

    private async applyChanges(
        editor: vscode.TextEditor, 
        newContent: string, 
        targetRange?: vscode.Range
    ): Promise<void> {
        await editor.edit(editBuilder => {
            if (targetRange) {
                editBuilder.replace(targetRange, newContent);
            } else {
                const position = editor.selection.active;
                editBuilder.insert(position, '\n' + newContent + '\n');
            }
        });

        vscode.window.showInformationMessage('Mudanças aplicadas com sucesso!');
    }

    async showLastDiff(): Promise<void> {
        if (this.lastDiffUris) {
            await vscode.commands.executeCommand(
                'vscode.diff',
                this.lastDiffUris.original,
                this.lastDiffUris.modified,
                'Último Diff Gerado'
            );
        } else {
            vscode.window.showInformationMessage('Nenhum diff anterior encontrado');
        }
    }
}