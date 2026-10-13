import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as vscode from 'vscode';
import { VoicePanelProvider } from '../voicePanelProvider';

describe('VoicePanelProvider message protocol', () => {
  it('sends audioChunk, stateChange, userCaption, modelCaption to webview', () => {
    let postedMessages: any[] = [];
    
    // Create a mock panel
    const mockPanel: any = {
      webview: {
        postMessage: (msg: any) => {
          postedMessages.push(msg);
        },
        onDidReceiveMessage: () => {},
        html: ''
      },
      onDidDispose: () => {},
      dispose: () => {}
    };

    // Instantiate directly bypassing createOrShow
    const provider = new (VoicePanelProvider as any)(mockPanel, { fsPath: '/test' } as any);
    
    provider.sendAudioChunk('AQID');
    assert.strictEqual(postedMessages[postedMessages.length - 1].type, 'audioChunk');
    assert.strictEqual(postedMessages[postedMessages.length - 1].data, 'AQID');

    provider.sendUserCaption('hello');
    assert.strictEqual(postedMessages[postedMessages.length - 1].type, 'userCaption');
    assert.strictEqual(postedMessages[postedMessages.length - 1].text, 'hello');

    provider.sendModelCaption('hi');
    assert.strictEqual(postedMessages[postedMessages.length - 1].type, 'modelCaption');
    assert.strictEqual(postedMessages[postedMessages.length - 1].text, 'hi');

    provider.updateState('listening', 'Details');
    assert.strictEqual(postedMessages[postedMessages.length - 1].type, 'stateChange');
    assert.strictEqual(postedMessages[postedMessages.length - 1].state, 'listening');
    assert.strictEqual(postedMessages[postedMessages.length - 1].details, 'Details');

    provider.notifyInterrupted();
    assert.strictEqual(postedMessages[postedMessages.length - 1].type, 'interrupted');
  });
});
