import { AgentRunFailure, createAgentRunError, createMissingApiKeyAgentRunError } from 'memeloop/mobile';

import { resolveMobileAgentErrorPresentation } from '../errorPresentation';

const options = {
  localize: (messageKey: string) => ({ title: 'Agent failed', message: `localized:${messageKey}` }),
  settingActionLabel: () => 'Open settings',
};

describe('mobile agent configurable error routing', () => {
  it.each(['siliconflow', 'cpa'])('routes a typed missing %s key to its exact provider credential field', (providerId) => {
    const error = new AgentRunFailure(createMissingApiKeyAgentRunError({ providerId }));
    expect(resolveMobileAgentErrorPresentation(error, options)).toMatchObject({
      actionId: 'agent-run-setting',
      actionLabel: 'Open settings',
      errorCode: 'PROVIDER_AUTH_MISSING',
      settingTarget: { kind: 'provider', providerId, field: 'apiKey' },
    });
  });

  it('routes a typed network failure without exposing diagnostic internals', () => {
    const failure = new AgentRunFailure(createAgentRunError({
      code: 'NETWORK_UNAVAILABLE',
      messageKey: 'agent.run.error.networkUnavailable',
      retryable: true,
      settingTarget: { kind: 'runtime', section: 'network' },
    }));
    expect(resolveMobileAgentErrorPresentation(failure, options)).toMatchObject({
      actionId: 'agent-run-setting',
      message: 'localized:agent.run.error.networkUnavailable',
      settingTarget: { kind: 'runtime', section: 'network' },
    });
  });

  it.each(
    [
      ['USER_MESSAGE_TOO_LARGE', 'agent.run.error.userMessageTooLarge', { limit: 131_072, requested: 131_073 }],
      ['CONTEXT_COMPACTION_PENDING', 'agent.run.error.contextCompactionPending', {
        checkpointRevision: 'checkpoint-7',
        processedMessages: 400,
        remainingEstimate: 12,
      }],
    ] as const,
  )('keeps %s on the typed localized retry path', (code, messageKey, localizedParameters) => {
    const failure = new AgentRunFailure(createAgentRunError({
      code,
      localizedParams: localizedParameters,
      messageKey,
      retryable: true,
    }));
    expect(resolveMobileAgentErrorPresentation(failure, options)).toMatchObject({
      errorCode: code,
      message: `localized:${messageKey}`,
      retryable: true,
    });
  });

  it('fails closed for raw SDK/provider error text', () => {
    expect(resolveMobileAgentErrorPresentation(new Error('API key for siliconflow not found: sk-secret'), options)).toBeNull();
  });
});
