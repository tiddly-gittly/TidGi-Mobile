/**
 * MobilePeerNodeTransport: Implements PeerNodeTransport for TidGi-Mobile.
 *
 * Bridges the ChatSyncEngine's PeerNodeSyncAdapter with MemeLoopService's RPC layer.
 * Provides version vector exchange, metadata sync, and on-demand message/attachment pulling.
 */

import { getMemeLoopService } from './MemeLoopService';
import type { ChatMessage, ConversationMeta } from './protocol-types';

export interface PeerNodeTransport {
  nodeId: string;
  exchangeVersionVector(
    targetNodeId: string,
    localVersion: Record<string, number>,
  ): Promise<{
    remoteVersion: Record<string, number>;
    missingForRemote: ConversationMeta[];
  }>;
  pullMissingMetadata(
    targetNodeId: string,
    sinceVersion: Record<string, number>,
  ): Promise<ConversationMeta[]>;
  pullMissingMessages?(
    targetNodeId: string,
    conversationId: string,
    knownMessageIds: string[],
  ): Promise<ChatMessage[]>;
  pullAttachmentBlob?(
    targetNodeId: string,
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
 * Mobile implementation of PeerNodeTransport using MemeLoopService RPC calls.
 */
export class MobilePeerNodeTransport implements PeerNodeTransport {
  public readonly nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  async exchangeVersionVector(
    targetNodeId: string,
    localVersion: Record<string, number>,
  ): Promise<{
    remoteVersion: Record<string, number>;
    missingForRemote: ConversationMeta[];
  }> {
    const service = getMemeLoopService();
    return service.rpcCall<{
      remoteVersion: Record<string, number>;
      missingForRemote: ConversationMeta[];
    }>(targetNodeId, 'memeloop.sync.exchangeVersionVector', { localVersion });
  }

  async pullMissingMetadata(
    targetNodeId: string,
    sinceVersion: Record<string, number>,
  ): Promise<ConversationMeta[]> {
    const service = getMemeLoopService();
    const result = await service.rpcCall<{ metas: ConversationMeta[] }>(
      targetNodeId,
      'memeloop.sync.pullMissingMetadata',
      { sinceVersion },
    );
    return result.metas;
  }

  async pullMissingMessages(
    targetNodeId: string,
    conversationId: string,
    knownMessageIds: string[],
  ): Promise<ChatMessage[]> {
    const service = getMemeLoopService();
    const result = await service.rpcCall<{ messages: ChatMessage[] }>(
      targetNodeId,
      'memeloop.sync.pullMissingMessages',
      { conversationId, knownMessageIds },
    );
    return result.messages;
  }

  async pullAttachmentBlob(
    targetNodeId: string,
    contentHash: string,
  ): Promise<
    {
      data: Uint8Array;
      filename: string;
      mimeType: string;
      size: number;
    } | null
  > {
    const service = getMemeLoopService();
    const result = await service.rpcCall<
      {
        found?: boolean;
        error?: string;
        dataBase64?: string;
        filename: string;
        mimeType: string;
        size: number;
      } | null
    >(targetNodeId, 'memeloop.storage.getAttachmentBlob', {
      contentHash,
    });
    if (!result || result.found === false) {
      return null;
    }
    if (!result.dataBase64) {
      throw new Error(
        result.error ?? 'Attachment blob payload missing dataBase64',
      );
    }
    return {
      data: Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0)),
      filename: result.filename,
      mimeType: result.mimeType,
      size: result.size,
    };
  }
}
