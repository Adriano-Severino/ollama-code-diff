import * as path from 'path';
import { runTests } from '@vscode/test-electron';

function getVsCodeExecutablePath(): string | undefined {
  return process.env.VSCODE_EXECUTABLE_PATH || undefined;
}

async function main() {
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;

    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const vscodeExecutablePath = getVsCodeExecutablePath();

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-extensions'],
      vscodeExecutablePath
    });
  } catch (error) {
    console.error('Failed to run VS Code tests:', error);
    process.exit(1);
  }
}

void main();
