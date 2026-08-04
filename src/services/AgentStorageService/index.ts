import { Buffer } from 'buffer';
import { Directory, File, Paths } from 'expo-file-system';
import type { AgentDefinition, AgentInstanceMeta, AttachmentReference, ChatMessage, ConversationMeta, GetMessagesOptions, IAgentStorage, ListConversationsOptions } from 'memeloop';

interface PersistedAgentData {
  attachments: Partial<Record<string, { dataBase64: string; reference: AttachmentReference }>>;
  conversations: Partial<Record<string, ConversationMeta>>;
  definitions: Partial<Record<string, AgentDefinition>>;
  instances: Partial<Record<string, AgentInstanceMeta>>;
  lamportClocks: Partial<Record<string, number>>;
  messages: Partial<Record<string, ChatMessage[]>>;
}

const emptyData = (): PersistedAgentData => ({
  attachments: {},
  conversations: {},
  definitions: {},
  instances: {},
  lamportClocks: {},
  messages: {},
});

function sortMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort((left, right) => left.lamportClock - right.lamportClock || left.timestamp - right.timestamp || left.messageId.localeCompare(right.messageId));
}

function mergeMessages(existing: readonly ChatMessage[], incoming: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map(existing.map(message => [message.messageId, message]));
  for (const message of incoming) byId.set(message.messageId, message);
  return sortMessages([...byId.values()]);
}

function recordLamportClock(data: PersistedAgentData, message: ChatMessage): void {
  const current = data.lamportClocks[message.conversationId] ?? 0;
  if (Number.isSafeInteger(message.lamportClock) && message.lamportClock > current) {
    data.lamportClocks[message.conversationId] = message.lamportClock;
  }
}

function metadataFromMessages(conversationId: string, messages: readonly ChatMessage[], existing?: ConversationMeta): ConversationMeta {
  const sorted = sortMessages(messages);
  const last = sorted.at(-1);
  const firstUser = sorted.find(message => message.role === 'user');
  return {
    conversationId,
    title: existing?.title || firstUser?.content.slice(0, 80) || 'Mobile conversation',
    lastMessagePreview: last?.content.slice(0, 240) ?? '',
    lastMessageTimestamp: last?.timestamp ?? existing?.lastMessageTimestamp ?? Date.now(),
    messageCount: sorted.length,
    originNodeId: existing?.originNodeId || firstUser?.originNodeId || last?.originNodeId || 'tidgi-mobile',
    originClock: Math.max(existing?.originClock ?? 0, last?.lamportClock ?? 0),
    definitionId: existing?.definitionId || 'memeloop:general-assistant',
    ...(existing?.instanceDelta ? { instanceDelta: existing.instanceDelta } : {}),
    isUserInitiated: existing?.isUserInitiated ?? true,
    ...(existing?.sourceChannel ? { sourceChannel: existing.sourceChannel } : {}),
  };
}

/** Durable JSON storage shared by the local loop and device sync transport. */
export class MobileAgentStorage implements IAgentStorage {
  private readonly directory = new Directory(Paths.document, 'memeloop');
  private readonly file = new File(this.directory, 'agent-data-v1.json');
  private data?: PersistedAgentData;
  private mutationQueue = Promise.resolve();

  public async listConversations(options: ListConversationsOptions = {}): Promise<ConversationMeta[]> {
    const data = await this.load();
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.max(0, options.limit ?? Number.MAX_SAFE_INTEGER);
    return Object.values(data.conversations)
      .filter((conversation): conversation is ConversationMeta => conversation !== undefined)
      .sort((left, right) => right.lastMessageTimestamp - left.lastMessageTimestamp)
      .slice(offset, offset + limit);
  }

  public async getMessages(conversationId: string, _options?: GetMessagesOptions): Promise<ChatMessage[]> {
    return sortMessages((await this.load()).messages[conversationId] ?? []);
  }

  public async replaceMessages(conversationId: string, messages: readonly ChatMessage[]): Promise<void> {
    await this.mutate((data) => {
      const merged = mergeMessages(data.messages[conversationId] ?? [], messages);
      data.messages[conversationId] = merged;
      for (const message of merged) recordLamportClock(data, message);
      data.conversations[conversationId] = metadataFromMessages(conversationId, merged, data.conversations[conversationId]);
    });
  }

  public async appendMessage(message: ChatMessage): Promise<void> {
    await this.insertMessagesIfAbsent([message]);
  }

  public async insertMessagesIfAbsent(messages: ChatMessage[]): Promise<void> {
    await this.mutate((data) => {
      const affected = new Set<string>();
      for (const message of messages) {
        const existing = data.messages[message.conversationId] ?? [];
        if (!existing.some(item => item.messageId === message.messageId)) existing.push(message);
        data.messages[message.conversationId] = existing;
        recordLamportClock(data, message);
        affected.add(message.conversationId);
      }
      for (const conversationId of affected) {
        const conversationMessages = data.messages[conversationId] ?? [];
        data.messages[conversationId] = sortMessages(conversationMessages);
        data.conversations[conversationId] = metadataFromMessages(conversationId, conversationMessages, data.conversations[conversationId]);
      }
    });
  }

  public async getMaxLamportClockForConversation(conversationId: string): Promise<number> {
    const data = await this.load();
    const messages = data.messages[conversationId] ?? [];
    return Math.max(
      data.lamportClocks[conversationId] ?? 0,
      messages.reduce((maximum, message) => Math.max(maximum, message.lamportClock), 0),
    );
  }

  /** Atomically reserves the next durable Lamport clock for a conversation. */
  public async nextLamportClockForConversation(conversationId: string): Promise<number> {
    let nextClock = 0;
    await this.mutate((data) => {
      const messageMaximum = (data.messages[conversationId] ?? [])
        .reduce((maximum, message) => Math.max(maximum, message.lamportClock), 0);
      nextClock = Math.max(data.lamportClocks[conversationId] ?? 0, messageMaximum) + 1;
      data.lamportClocks[conversationId] = nextClock;
    });
    return nextClock;
  }

  public async createMessage(
    conversationId: string,
    role: ChatMessage['role'],
    content: string,
    originNodeId = 'tidgi-mobile',
  ): Promise<ChatMessage> {
    const lamportClock = await this.nextLamportClockForConversation(conversationId);
    const timestamp = Date.now();
    return {
      messageId: `mobile-agent-${conversationId}-${timestamp}-${lamportClock}`,
      conversationId,
      originNodeId,
      timestamp,
      lamportClock,
      role,
      content,
    };
  }

  public async upsertConversationMetadata(meta: ConversationMeta): Promise<void> {
    await this.mutate((data) => {
      const messages = data.messages[meta.conversationId] ?? [];
      data.conversations[meta.conversationId] = messages.length > 0
        ? metadataFromMessages(meta.conversationId, messages, { ...data.conversations[meta.conversationId], ...meta })
        : meta;
    });
  }

  public async getConversationMeta(conversationId: string): Promise<ConversationMeta | null> {
    return (await this.load()).conversations[conversationId] ?? null;
  }

  public async getAttachment(contentHash: string): Promise<AttachmentReference | null> {
    return (await this.load()).attachments[contentHash]?.reference ?? null;
  }

  public async saveAttachment(reference: AttachmentReference, bytes: Uint8Array): Promise<void> {
    await this.mutate((data) => {
      data.attachments[reference.contentHash] = {
        reference,
        dataBase64: Buffer.from(bytes).toString('base64'),
      };
    });
  }

  public async readAttachmentData(contentHash: string): Promise<Uint8Array | null> {
    const stored = (await this.load()).attachments[contentHash];
    return stored ? new Uint8Array(Buffer.from(stored.dataBase64, 'base64')) : null;
  }

  public async getAgentDefinition(id: string): Promise<AgentDefinition | null> {
    return (await this.load()).definitions[id] ?? null;
  }

  public async saveAgentInstance(meta: AgentInstanceMeta): Promise<void> {
    await this.mutate((data) => {
      data.instances[meta.instanceId] = meta;
    });
  }

  private async load(): Promise<PersistedAgentData> {
    if (this.data) return this.data;
    if (!this.directory.exists) this.directory.create({ intermediates: true });
    if (!this.file.exists) {
      this.data = emptyData();
      return this.data;
    }
    try {
      const parsed = JSON.parse(await this.file.text()) as Partial<PersistedAgentData>;
      this.data = {
        attachments: parsed.attachments ?? {},
        conversations: parsed.conversations ?? {},
        definitions: parsed.definitions ?? {},
        instances: parsed.instances ?? {},
        lamportClocks: parsed.lamportClocks ?? {},
        messages: parsed.messages ?? {},
      };
    } catch (error) {
      console.warn('[MobileAgentStorage] invalid data file; starting with an empty store', error);
      this.data = emptyData();
    }
    return this.data;
  }

  private async mutate(mutator: (data: PersistedAgentData) => void): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const data = await this.load();
      mutator(data);
      this.file.write(JSON.stringify(data));
    });
    this.mutationQueue = operation.catch(() => undefined);
    await operation;
  }
}

export const mobileAgentStorage = new MobileAgentStorage();
