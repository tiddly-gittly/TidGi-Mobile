import { createOpenAI } from '@ai-sdk/openai';
import { AgentRunFailure, createMissingProviderSettingAgentRunError } from 'memeloop/mobile';
import { createFetchLLMProvider } from 'memeloop/mobile/providers';

import { mobileAgentStorage } from '../AgentStorageService';
import { deviceNetworkService } from '../DeviceNetworkService';
import { loadExternalAPIConfig } from '../ExternalAPIService/config';
import { createSecureDurableId } from '../SecureIdService';
import { getMobileAgentLoopService, MobileAgentLoopService } from './index';

/** Shared entry for foreground chat and persisted local goal recovery. */
export async function getConfiguredMobileAgentLoopService(): Promise<MobileAgentLoopService> {
  const identity = await deviceNetworkService.getLocalIdentity();
  const connection = await loadExternalAPIConfig();
  if (!connection) {
    throw new AgentRunFailure(createMissingProviderSettingAgentRunError({
      providerId: 'selected',
      field: 'apiKey',
    }));
  }
  const openai = createOpenAI({ baseURL: connection.baseURL, apiKey: connection.apiKey });
  const provider = createFetchLLMProvider({
    name: connection.providerId,
    modelId: connection.modelId,
    apiMode: connection.apiMode,
    createModel: requestedModelId => {
      const modelId = requestedModelId ?? connection.wireModelId;
      return connection.apiMode === 'responses' ? openai.responses(modelId) : openai.chat(modelId);
    },
  });
  const configurationIdentity = JSON.stringify([
    identity.peerId,
    connection.providerId,
    connection.modelId,
    connection.wireModelId,
    connection.apiMode,
    connection.baseURL,
    connection.apiKey,
  ]);
  return getMobileAgentLoopService(
    configurationIdentity,
    () =>
      new MobileAgentLoopService(provider, identity.peerId, mobileAgentStorage, createSecureDurableId, {
        apiMode: connection.apiMode,
        modelId: connection.modelId,
        wireModelId: connection.wireModelId,
        providerId: connection.providerId,
      }),
  );
}

/** Opening the app recovers local work even while the chat screen is unmounted. */
export async function restoreConfiguredMobileGoals(): Promise<void> {
  const identity = await deviceNetworkService.getLocalIdentity();
  const goals = await mobileAgentStorage.goals.listActive(identity.peerId);
  if (goals.items.length === 0 || !await loadExternalAPIConfig()) return;
  await getConfiguredMobileAgentLoopService();
}
