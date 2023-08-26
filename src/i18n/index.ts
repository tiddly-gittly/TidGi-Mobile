import { use } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'react-native-localize';

import en from './localization/locales/en/translation.json';
import zh_CN from './localization/locales/zh_CN/translation.json';

void use(initReactI18next).init({
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
});

export { default } from 'i18next';
