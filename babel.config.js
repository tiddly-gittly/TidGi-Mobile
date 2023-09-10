/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['@babel/preset-typescript', 'babel-preset-expo'],
    plugins: [
      ['import', {
        libraryName: 'lodash',
        libraryDirectory: '',
        camel2DashComponentName: false, // default: true
      }],
      '@babel/plugin-transform-flow-strip-types',
      ['@babel/plugin-transform-private-methods', { loose: true }],
      'babel-plugin-transform-typescript-metadata',
    ],
  };
};
