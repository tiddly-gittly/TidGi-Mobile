/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-proposal-decorators', { version: 'legacy' }],
      ['import', {
        libraryName: 'lodash',
        libraryDirectory: '',
        camel2DashComponentName: false, // default: true
      }],
      ['import', {
        libraryName: 'date-fns',
        libraryDirectory: '',
        camel2DashComponentName: false, // default: true
      }, 'import-date-fns'],
      '@babel/plugin-transform-flow-strip-types',
      ['@babel/plugin-transform-private-methods', { loose: true }],
      'babel-plugin-transform-typescript-metadata',
      ['inline-import', { extensions: ['.sql'] }],
    ],
  };
};
