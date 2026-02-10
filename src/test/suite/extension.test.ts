import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration', () => {
  test('activates the extension', async () => {
    const extension = vscode.extensions.getExtension('adriano-severino.ollama-code-diff');
    assert.ok(extension, 'Extension not found');

    await extension!.activate();
    assert.ok(extension!.isActive, 'Extension did not activate');
  });

  test('registers expected commands', async () => {
    const commands = await vscode.commands.getCommands(true);

    const expected = [
      'ollama-code-diff.generateCode',
      'ollama-code-diff.editCode',
      'ollama-code-diff.analyzeFile',
      'ollama-code-diff.analyzeProject',
      'ollama-code-diff.analyzeMultipleFiles',
      'ollama-code-diff.showDiff',
      'ollama-code-diff.undoLastAppliedChanges',
      'ollama-code-diff.showMenu',
      'ollama-code-diff.validateConfig',
      'ollama-code-diff.fixDiagnostic',
      'ollama-code-diff.indexCodebase',
      'ollama-code-diff.semanticSearch'
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });
});
