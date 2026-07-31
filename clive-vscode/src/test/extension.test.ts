import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Clive Extension', () => {
  test('registers expected commands', async () => {
    // Force activation so runtime-registered commands are present.
    await vscode.commands.executeCommand('clive.openChat');

    const commands = await vscode.commands.getCommands(true);
    const expected = [
      'clive.openChat',
      'clive.chat',
      'clive.session',
      'clive.agent',
      'clive.models',
      'clive.doctor',
      'clive.ollamaServe',
      'clive.ollamaPull',
      'clive.ollamaRemove',
      'clive.ollamaRecommend',
      'clive.editFile',
      'clive.patchFile',
      'clive.completions',
      'clive.showOutput',
      'clive.runRawCommand',
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `missing command: ${command}`);
    }
  });

  test('webview command can be invoked', async () => {
    await vscode.commands.executeCommand('clive.openChat');
  });
});
