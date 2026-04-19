import { LIN_ONETWO_WIKI } from '../../../constants/webview';
import { PreferenceSectionSchema } from './types';

export const preferenceSections: PreferenceSectionSchema[] = [
  {
    id: 'general',
    titleKey: 'Preference.General',
    items: [
      {
        type: 'segmented',
        key: 'theme',
        titleKey: 'Preference.Theme',
        configKey: 'theme',
        options: [
          { labelKey: 'Preference.SystemDefault', value: 'default' },
          { labelKey: 'Preference.LightTheme', value: 'light' },
          { labelKey: 'Preference.DarkTheme', value: 'dark' },
        ],
      },
      {
        type: 'toggle',
        key: 'translucentStatusBar',
        titleKey: 'Preference.TranslucentStatusBar',
        descriptionKey: 'Preference.TranslucentStatusBarDescription',
        configKey: 'translucentStatusBar',
      },
      {
        type: 'toggle',
        key: 'hideStatusBar',
        titleKey: 'Preference.HideStatusBar',
        descriptionKey: 'Preference.HideStatusBarDescription',
        configKey: 'hideStatusBar',
      },
    ],
  },
  {
    id: 'performance',
    titleKey: 'Preference.Performance',
    items: [
      {
        type: 'toggle',
        key: 'keepAliveInBackground',
        titleKey: 'Preference.KeepAliveInBackground',
        descriptionKey: 'Preference.KeepAliveInBackgroundDescription',
        configKey: 'keepAliveInBackground',
      },
      {
        type: 'toggle',
        key: 'autoOpenDefaultWiki',
        titleKey: 'Preference.AutoOpenDefaultWiki',
        descriptionKey: 'Preference.AutoOpenDefaultWikiDescription',
        configKey: 'autoOpenDefaultWiki',
      },
      {
        type: 'toggle',
        key: 'androidHardwareAcceleration',
        titleKey: 'Preference.AndroidHardwareAcceleration',
        descriptionKey: 'Preference.AndroidHardwareAccelerationDescription',
        configKey: 'androidHardwareAcceleration',
        platform: 'android',
      },
    ],
  },
  {
    id: 'tiddlywiki',
    titleKey: 'Preference.TiddlyWiki',
    items: [
      {
        type: 'text-input',
        key: 'userName',
        titleKey: 'Preference.DefaultUserName',
        descriptionKey: 'Preference.DefaultUserNameDetail',
        configKey: 'userName',
        debounce: true,
      },
      {
        type: 'toggle',
        key: 'rememberLastVisitState',
        titleKey: 'Preference.RememberLastVisitState',
        configKey: 'rememberLastVisitState',
      },
    ],
  },
  {
    id: 'sync',
    titleKey: 'Preference.Sync',
    items: [
      {
        type: 'custom',
        key: 'sync-actions',
        titleKey: 'Preference.Sync',
        customKey: 'sync-actions',
      },
      {
        type: 'custom',
        key: 'storage-location',
        titleKey: 'Preference.StorageLocation',
        customKey: 'storage-location',
      },
      {
        type: 'custom',
        key: 'server-list',
        titleKey: 'AddWorkspace.ServerList',
        customKey: 'server-list',
      },
      {
        type: 'action',
        key: 'clear-server-list',
        titleKey: 'Preference.ClearServerList',
        buttonTitleKey: 'Preference.ClearServerList',
        buttonMode: 'text',
        actionId: 'clear-server-list',
      },
    ],
  },
  {
    id: 'shared',
    titleKey: 'Preference.Shared',
    items: [
      {
        type: 'text-input',
        key: 'tagForSharedContent',
        titleKey: 'Share.TagForSharedContent',
        configKey: 'tagForSharedContent',
        debounce: true,
      },
      {
        type: 'toggle',
        key: 'fastImport',
        titleKey: 'Share.FastImport',
        descriptionKey: 'Share.FastImportDescription',
        configKey: 'fastImport',
      },
      {
        type: 'toggle',
        key: 'saveMediaAsAttachment',
        titleKey: 'Share.SaveMediaAsAttachment',
        descriptionKey: 'Share.SaveMediaAsAttachmentDescription',
        configKey: 'saveMediaAsAttachment',
      },
    ],
  },
  {
    id: 'languages',
    titleKey: 'Preference.Languages',
    items: [
      {
        type: 'custom',
        key: 'language-selector',
        titleKey: 'Preference.ChooseLanguage',
        customKey: 'language-selector',
      },
    ],
  },
  {
    id: 'about',
    titleKey: 'ContextMenu.About',
    items: [
      {
        type: 'link',
        key: 'about-lin-onetwo',
        titleKey: 'Dialog.MadeWithLove',
        url: LIN_ONETWO_WIKI,
        linkTextKey: 'LinOnetwo',
      },
    ],
  },
  {
    id: 'developer',
    titleKey: 'Preference.DeveloperTools',
    items: [
      {
        type: 'custom',
        key: 'debug-info',
        titleKey: 'Preference.AppVersionInfo',
        customKey: 'debug-info',
      },
      {
        type: 'action',
        key: 'clear-wiki-data',
        titleKey: 'Preference.RemoveAllWikiData',
        descriptionKey: 'Preference.RemoveAllWikiDataDetail',
        buttonTitleKey: 'Preference.RemoveAllWikiData',
        buttonMode: 'outlined',
        confirmTitleKey: 'Preference.RemoveAllWikiData',
        confirmMessageKey: 'Preference.RemoveAllWikiDataDetail',
        actionId: 'clear-wiki-data',
      },
      {
        type: 'custom',
        key: 'view-app-log',
        titleKey: 'Preference.ViewAppLog',
        customKey: 'view-app-log',
      },
    ],
  },
];
