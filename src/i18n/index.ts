/* eslint-disable import/no-named-as-default-member */
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './localization/locales/en/translation.json';
import zh_CN from './localization/locales/zh_CN/translation.json';

void i18n.use(initReactI18next).init({
  lng: getLocales()[0].languageCode,
  fallbackLng: 'en',
  resources: {
    en: {
      translation: en,
    },
    zh_CN: {
      translation: zh_CN,
    },
  },
  compatibilityJSON: 'v3',
});

export { default } from 'i18next';
