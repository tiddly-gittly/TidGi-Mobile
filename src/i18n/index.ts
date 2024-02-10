/* eslint-disable import/no-named-as-default-member */
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { useConfigStore } from '../store/config';
import en from './localization/locales/en/translation.json';
import zh_CN from './localization/locales/zh_CN/translation.json';

export const defaultLanguage = 'zh_CN';
export const supportedLanguages = [
  { label: 'English', value: 'en' },
  { label: '中文（简体）', value: defaultLanguage },
  // ... Add other languages here
];
export const detectedLanguage = getLocales()[0].languageCode;
void i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  resources: {
    en: {
      translation: en,
    },
    zh_CN: {
      translation: zh_CN,
    },
    // getLocales()[0].languageCode returns zh instead of zh_CN
    zh: {
      translation: zh_CN,
    },
  },
  compatibilityJSON: 'v3',
  // getState() only have value when it is in dev mode hot reload, will return default value on production, use `subscribe` as below to fix this.
  lng: useConfigStore.getState().preferredLanguage ?? detectedLanguage ?? defaultLanguage,
});
// incase store is not loaded from asyncStorage at this time, we need to subscribe to the store to get the latest value
useConfigStore.subscribe((state) => {
  void i18n.changeLanguage(state.preferredLanguage ?? detectedLanguage ?? defaultLanguage);
});

export { default } from 'i18next';
