import type { ConversationListPageSuccess, ConversationMeta, GetConversationListPageOptions } from 'memeloop';

import {
  MOBILE_CONVERSATION_DIRECTORY_MAX_BYTES,
  MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE,
  MOBILE_CONVERSATION_DIRECTORY_RESIDENT_LIMIT,
  type MobileConversationDirectoryClient,
  MobileConversationDirectoryController,
  mobileConversationDirectoryDirection,
  mobileConversationDirectoryErrorCode,
  mobileConversationDirectoryErrorMessageKey,
} from '../conversationDirectory';

function conversation(index: number): ConversationMeta {
  return {
    conversationId: `conversation-${index}`,
    title: `Conversation ${index}`,
    lastMessagePreview: `Preview ${index}`,
    lastMessageTimestamp: 100_000 - index,
    messageCount: index,
    originNodeId: 'phone-peer',
    originClock: index + 1,
    definitionId: 'memeloop:general-assistant',
    isUserInitiated: true,
  };
}

function cursorIndex(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  const match = /^conversation-(\d+)$/u.exec(cursor);
  if (!match) throw new Error('invalid_test_cursor');
  return Number(match[1]);
}

function createLargeDirectory(total = 100_000) {
  const calls: GetConversationListPageOptions[] = [];
  let revision = 'revision-1';
  let resetNextCursorRead = false;
  const client: MobileConversationDirectoryClient = {
    listConversationsPage: options => {
      calls.push(options);
      if (resetNextCursorRead && options.expectedRevision) {
        resetNextCursorRead = false;
        revision = 'revision-2';
        return Promise.resolve({ reset: true as const, revision });
      }
      const before = cursorIndex(options.beforeCursor);
      const after = cursorIndex(options.afterCursor);
      let start = 0;
      let end = Math.min(total, options.limit);
      if (before !== undefined) {
        start = before + 1;
        end = Math.min(total, start + options.limit);
      } else if (after !== undefined) {
        end = after;
        start = Math.max(0, end - options.limit);
      }
      const items = Array.from({ length: Math.max(0, end - start) }, (_, offset) => conversation(start + offset));
      return Promise.resolve(
        {
          reset: false,
          items,
          revision,
          total,
          hasMoreBefore: end < total,
          hasMoreAfter: start > 0,
          ...(items[0] ? { startCursor: items[0].conversationId } : {}),
          ...(items.at(-1) ? { endCursor: items.at(-1)!.conversationId } : {}),
        } satisfies ConversationListPageSuccess,
      );
    },
  };
  return {
    calls,
    client,
    resetNextCursorRead: () => {
      resetNextCursorRead = true;
    },
  };
}

describe('MobileConversationDirectoryController', () => {
  it('pages beyond the first 20 without materializing a 100k directory', async () => {
    const source = createLargeDirectory();
    const controller = new MobileConversationDirectoryController(source.client);

    await controller.start();
    expect(controller.getSnapshot()).toMatchObject({
      total: 100_000,
      hasMoreOlder: true,
      hasMoreNewer: false,
    });
    expect(controller.getSnapshot().items).toHaveLength(MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE);
    expect(controller.getSnapshot().items.at(-1)?.conversationId).toBe('conversation-19');

    await controller.loadOlder();
    expect(controller.getSnapshot().items).toHaveLength(40);
    expect(controller.getSnapshot().items.some(item => item.conversationId === 'conversation-25')).toBe(true);
    expect(source.calls.every(call => call.limit === MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE)).toBe(true);
    expect(source.calls.every(call => call.maxBytes === MOBILE_CONVERSATION_DIRECTORY_MAX_BYTES)).toBe(true);
    controller.dispose();
  });

  it('keeps a contiguous bounded window while old conversations remain reachable in both directions', async () => {
    const source = createLargeDirectory();
    const controller = new MobileConversationDirectoryController(source.client);
    await controller.start();
    for (let page = 0; page < 5; page += 1) await controller.loadOlder();

    const oldWindow = controller.getSnapshot();
    expect(oldWindow.items).toHaveLength(MOBILE_CONVERSATION_DIRECTORY_RESIDENT_LIMIT);
    expect(oldWindow.items[0]?.conversationId).toBe('conversation-20');
    expect(oldWindow.items.at(-1)?.conversationId).toBe('conversation-119');
    expect(oldWindow.hasMoreNewer).toBe(true);
    expect(oldWindow.hasMoreOlder).toBe(true);

    await controller.loadNewer();
    const newerWindow = controller.getSnapshot();
    expect(newerWindow.items).toHaveLength(MOBILE_CONVERSATION_DIRECTORY_RESIDENT_LIMIT);
    expect(newerWindow.items[0]?.conversationId).toBe('conversation-0');
    expect(newerWindow.items.at(-1)?.conversationId).toBe('conversation-99');
    expect(newerWindow.hasMoreOlder).toBe(true);
    controller.dispose();
  });

  it('can reach the oldest entry in a 100k directory without exceeding the resident bound', async () => {
    const source = createLargeDirectory();
    const controller = new MobileConversationDirectoryController(source.client);
    await controller.start();

    while (controller.getSnapshot().hasMoreOlder) {
      await controller.loadOlder();
      expect(controller.getSnapshot().items.length).toBeLessThanOrEqual(MOBILE_CONVERSATION_DIRECTORY_RESIDENT_LIMIT);
    }

    expect(controller.getSnapshot().items.at(-1)?.conversationId).toBe('conversation-99999');
    expect(controller.getSnapshot().items[0]?.conversationId).toBe('conversation-99900');
    expect(controller.getSnapshot().hasMoreNewer).toBe(true);
    expect(source.calls).toHaveLength(100_000 / MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE);
    controller.dispose();
  });

  it('fails closed to one bounded latest page when a cursor revision resets', async () => {
    const source = createLargeDirectory();
    const controller = new MobileConversationDirectoryController(source.client);
    await controller.start();
    source.resetNextCursorRead();

    await controller.loadOlder();
    expect(controller.getSnapshot()).toMatchObject({ revision: 'revision-2', total: 100_000 });
    expect(controller.getSnapshot().items).toHaveLength(MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE);
    expect(source.calls.at(-1)).toEqual({
      limit: MOBILE_CONVERSATION_DIRECTORY_PAGE_SIZE,
      maxBytes: MOBILE_CONVERSATION_DIRECTORY_MAX_BYTES,
    });
    controller.dispose();
  });
});

describe('Mobile conversation directory direction', () => {
  it('preserves RTL and fails closed to LTR for unsupported direction values', () => {
    expect(mobileConversationDirectoryDirection('rtl')).toBe('rtl');
    expect(mobileConversationDirectoryDirection('ltr')).toBe('ltr');
    expect(mobileConversationDirectoryDirection('auto')).toBe('ltr');
  });
});

describe('Mobile conversation directory error presentation', () => {
  it('maps stable storage/request conditions without exposing provider details', () => {
    expect(mobileConversationDirectoryErrorCode(new Error('conversation_list_page_exceeds_byte_budget'))).toBe('too-large');
    expect(mobileConversationDirectoryErrorCode(new Error('invalid_mobile_conversation_cursor'))).toBe('invalid-request');
    expect(mobileConversationDirectoryErrorCode(new Error('Bearer super-secret-token'))).toBe('storage');
    expect(mobileConversationDirectoryErrorMessageKey(new Error('Bearer super-secret-token'))).toBe('AgentChat.ConversationDirectoryError');
  });
});
