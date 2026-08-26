import type { MobileAgentStorage } from '../../../services/AgentStorageService';
import { createMobileAgentSessionClients, startMobileAgentSession } from '../agentSessionClients';

describe('mobile shared session boundary', () => {
  it('contains an unexpected controller start rejection instead of creating an unhandled promise', async () => {
    const failure = new Error('invalid session target');
    const onUnexpectedError = jest.fn();
    const controller = { start: jest.fn().mockRejectedValue(failure) };

    expect(() => {
      startMobileAgentSession(
        controller,
        { agentId: 'agent', conversationId: 'conversation' },
        onUnexpectedError,
      );
    }).not.toThrow();
    await Promise.resolve();

    expect(controller.start).toHaveBeenCalledWith({ agentId: 'agent', conversationId: 'conversation' });
    expect(onUnexpectedError).toHaveBeenCalledWith(failure);
  });

  it('passes portable attachment sources and wiki descriptors to the coordinator executor unchanged', async () => {
    const send = jest.fn(() => Promise.resolve());
    const source = {
      kind: 'source' as const,
      filename: 'design.md',
      mimeType: 'text/markdown',
      totalBytes: 7,
      readChunk: jest.fn(() => Promise.resolve(new Uint8Array([1]))),
    };
    const wikiTiddlers = [{ tiddlerTitle: 'Game Design', workspaceName: 'Project' }];
    const clients = createMobileAgentSessionClients({} as MobileAgentStorage, {
      cancel: jest.fn(() => Promise.resolve()),
      delete: jest.fn(),
      retry: jest.fn(),
      send,
      subscribeToTransientMessages: () => () => {},
    });
    const signal = new AbortController().signal;

    await clients.conversationClient.sendMessage(
      'conversation',
      'review attachment',
      source,
      wikiTiddlers,
      { signal },
    );

    expect(send).toHaveBeenCalledWith('conversation', 'review attachment', source, wikiTiddlers, signal);
  });
});
