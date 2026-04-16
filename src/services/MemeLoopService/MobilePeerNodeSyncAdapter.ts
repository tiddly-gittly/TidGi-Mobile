/**
 * MobilePeerNodeSyncAdapter: ChatSyncPeer implementation for TidGi-Mobile.
 *
 * Wraps MobilePeerNodeTransport to provide the ChatSyncPeer interface
 * required by ChatSyncEngine.
 */

import { MobilePeerNodeTransport } from './MobilePeerNodeTransport';
import type { ChatMessage, ConversationMeta } from './protocol-types';

export interface ChatSyncPeer {
  nodeId: string;
  exchangeVersionVector(localVersion: Record<string, number>): Promise<{
    remoteVersion: Record<string, number>;
    missingForRemote: ConversationMeta[];
  }>;
  pullMissingMetadata(
    sinceVersion: Record<string, number>,
  ): Promise<ConversationMeta[]>;
  pullMissingMessages?(
    conversationId: string,
    knownMessageIds: string[],
  ): Promise<ChatMessage[]>;
  pullAttachmentBlob?(
    contentHash: string,
  ): Promise<
    {
      data: Uint8Array;
      filename: string;
      mimeType: string;
      size: number;
    } | null
  >;
}

/**
 * Adapter that implements ChatSyncPeer using MobilePeerNodeTransport.
 */
export class MobilePeerNodeSyncAdapter implements ChatSyncPeer {
  public readonly nodeId: string;
  private readonly transport: MobilePeerNodeTransport;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.transport = new MobilePeerNodeTransport(nodeId);
  }

  exchangeVersionVector(localVersion: Record<string, number>) {
    return this.transport.exchangeVersionVector(this.nodeId, localVersion);
  }

  pullMissingMetadata(sinceVersion: Record<string, number>) {
    return this.transport.pullMissingMetadata(this.nodeId, sinceVersion);
  }

  pullMissingMessages(
    conversationId: string,
    knownMessageIds: string[],
  ): Promise<ChatMessage[]> {
    return this.transport.pullMissingMessages(
      this.nodeId,
      conversationId,
      knownMessageIds,
    );
  }

  pullAttachmentBlob(contentHash: string) {
    return this.transport.pullAttachmentBlob(this.nodeId, contentHash);
  }
}
