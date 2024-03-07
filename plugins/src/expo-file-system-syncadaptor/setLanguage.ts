const setLanguage = () => {
  const { language } = window.meta?.() ?? {};
  let twLanguage = 'en-GB';
  switch (language) {
    case 'en': {
      twLanguage = 'en-GB';
      break;
    }
    case 'zh': {
      twLanguage = 'zh-CN';
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
