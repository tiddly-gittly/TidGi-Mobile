import { createInstance } from 'i18next';

import en from '../../../i18n/localization/locales/en/translation.json';
import ja from '../../../i18n/localization/locales/ja/translation.json';
import zhCN from '../../../i18n/localization/locales/zh_CN/translation.json';

describe('AgentChat localization coverage', () => {
  const nativeChatLabelKeys = [
    'User',
    'Agent',
    'Waiting',
    'LoadDetails',
    'ReloadDetails',
    'NoDetails',
    'Attachment',
    'DetailTruncated',
    'ExportFullMessage',
    'Close',
    'TruncatedMessage',
    'DiagnosticId',
  ] as const;
  const timelineLabelKeys = [
    'TimelineNavigation',
    'TimelineTurn',
    'TimelineCompacted',
    'LoadEarlier',
    'LoadLater',
    'TimelineSeek',
    'TimelineClose',
    'NewMessages',
    'TimelineMoreResponses',
  ] as const;
  const directoryLabelKeys = [
    'LoadNewerConversations',
    'LoadOlderConversations',
    'LoadingConversations',
    'ConversationDirectoryStatus',
  ] as const;

  it.each(
    [
      ['en', en],
      ['ja', ja],
      ['zh_CN', zhCN],
    ] as const,
  )('%s supplies every participant timeline label', (_locale, translation) => {
    expect(translation.AgentChat.TimelineMoreResponses).toContain('{{count}}');
    expect(translation.AgentChat.TimelineNavigation).not.toHaveLength(0);
    expect(translation.AgentChat.TimelineTurn).not.toHaveLength(0);
  });

  it.each(
    [
      ['en', en],
      ['ja', ja],
      ['zh_CN', zhCN],
    ] as const,
  )('%s supplies every shared native chat, timeline and directory label', (_locale, translation) => {
    for (const key of [...nativeChatLabelKeys, ...timelineLabelKeys, ...directoryLabelKeys]) {
      expect(translation.AgentChat[key]).not.toHaveLength(0);
    }
    expect(translation.AgentChat.TruncatedMessage).toContain('{{characters}}');
    expect(translation.AgentChat.DiagnosticId).toContain('{{id}}');
    expect(translation.AgentChat.Attachment).toContain('{{filename}}');
    expect(translation.AgentChat.ConversationDirectoryStatus).toContain('{{resident}}');
    expect(translation.AgentChat.ConversationDirectoryStatus).toContain('{{total}}');
  });

  it.each(
    [
      ['ja', ja],
      ['zh_CN', zhCN],
    ] as const,
  )('%s keeps the AgentChat locale contract in parity with English', (_locale, translation) => {
    expect(Object.keys(translation.AgentChat).sort()).toEqual(Object.keys(en.AgentChat).sort());
  });

  it.each(
    [
      ['en', en, 'Attachment: report.png'],
      ['zh-Hans', zhCN, '附件：report.png'],
    ] as const,
  )('%s interpolates the native attachment filename', async (locale, translation, expected) => {
    const instance = createInstance();
    await instance.init({
      fallbackLng: false,
      lng: locale,
      resources: { [locale]: { translation } },
    });

    expect(instance.t('AgentChat.Attachment', { filename: 'report.png' })).toBe(expected);
  });

  it('does not silently fall back to the English participant label', () => {
    expect(ja.AgentChat.TimelineMoreResponses).not.toBe(en.AgentChat.TimelineMoreResponses);
    expect(zhCN.AgentChat.TimelineMoreResponses).not.toBe(en.AgentChat.TimelineMoreResponses);
  });

  it.each(
    [
      ['en', en],
      ['ja', ja],
      ['zh_CN', zhCN],
    ] as const,
  )('%s localizes bounded-input and in-progress compaction errors', (_locale, translation) => {
    expect(translation.agent.run.error.userMessageTooLarge).toContain('{{requested}}');
    expect(translation.agent.run.error.userMessageTooLarge).toContain('{{limit}}');
    expect(translation.agent.run.error.contextCompactionPending).not.toHaveLength(0);
  });

  it.each(
    [
      ['en', en],
      ['ja', ja],
      ['zh_CN', zhCN],
    ] as const,
  )('%s supplies the complete shared scheduled-task surface', (_locale, translation) => {
    expect(translation.ScheduledTask.SourceOnline).toContain('{{executionTarget}}');
    expect(translation.ScheduledTask.SourceCached).toContain('{{executionTarget}}');
    expect(translation.ScheduledTask.ExecutionTargetUnavailable).not.toHaveLength(0);
    expect(translation.ScheduledTask.ThisPhoneEditorOnly).not.toHaveLength(0);
    for (const value of Object.values(translation.ScheduledTask)) expect(value).not.toHaveLength(0);
  });
});
