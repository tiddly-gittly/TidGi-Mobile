/* eslint-disable import/no-named-as-default-member */
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

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
  lng: detectedLanguage ?? defaultLanguage,
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
});

export { default } from 'i18next';
