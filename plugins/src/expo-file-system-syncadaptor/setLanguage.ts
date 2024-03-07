const setLanguage = () => {
  const { language } = window.meta?.() ?? {};
  let twLanguage = '$:/languages/en-GB';
  switch (language) {
    case 'en': {
      twLanguage = '$:/languages/en-GB';
      break;
    }
    case 'zh': {
      twLanguage = '$:/languages/zh-Hans';
      break;
    }
    default: {
      break;
    }
  }
  const existingTiddler = $tw.wiki.getTiddler('$:/language');
  if (existingTiddler?.fields?.text !== twLanguage) {
    $tw.wiki.addTiddler({
      ...existingTiddler?.fields,
      title: '$:/language',
      text: twLanguage,
    });
  }
};

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.startup = setLanguage;
exports.name = 'tidgi-set-language';
exports.platforms = ['browser'];
exports.after = ['startup'];
exports.synchronous = true;
