import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiffManager } from '../../diffManager';

suite('E2E Flows', () => {
  test('opens a diff view for edited content', async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: 'const value = 1;\n',
      language: 'typescript'
    });
    const editor = await vscode.window.showTextDocument(doc);

    const diffManager = new DiffManager();

    const originalShowInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => undefined;

    try {
      await diffManager.showCodeDiff(editor, 'const value = 2;\n', 'Teste Diff');

      const diffDocs = vscode.workspace.textDocuments.filter(
        d => d.uri.scheme === 'ollama-diff'
      );

      assert.ok(diffDocs.length >= 2, 'Expected diff documents to be created');
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInfo;
    }
  });
});
