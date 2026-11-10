import { type AgentRunErrorLocalizedText, type AgentRunErrorPresentation, resolveAgentRunErrorPresentation } from '@memeloop/react-ui/chat/core';
import type { AgentRunErrorLocalizationParameters, AgentRunErrorMessageKey, AgentRunErrorSettingTarget, ChatMessage, ConversationMessageListProjection } from 'memeloop/mobile';

export interface MobileAgentErrorPresentationOptions {
  localize: (
    key: AgentRunErrorMessageKey,
    parameters: AgentRunErrorLocalizationParameters,
  ) => AgentRunErrorLocalizedText;
  settingActionLabel: (target: AgentRunErrorSettingTarget) => string;
  remoteSettingsHint?: string;
}

/**
 * Mobile delegates strict extraction to the shared UI contract. Raw SDK
 * messages, provider bodies and stacks are never inspected or rendered.
 */
export function resolveMobileAgentErrorPresentation(
  error: Error | ChatMessage | ConversationMessageListProjection,
  options: MobileAgentErrorPresentationOptions,
): AgentRunErrorPresentation | null {
  const presentation = resolveAgentRunErrorPresentation(error, {
    localize: options.localize,
    settingActionLabel: options.settingActionLabel,
  });
  if (presentation?.settingTarget && options.remoteSettingsHint) {
    return { ...presentation, actionId: undefined, actionLabel: undefined, message: `${presentation.message} ${options.remoteSettingsHint}` };
  }
  if (presentation?.settingTarget?.kind === 'runtime' && presentation.settingTarget.section !== 'network') {
    return { ...presentation, actionId: undefined, actionLabel: undefined };
  }
  return presentation;
}
