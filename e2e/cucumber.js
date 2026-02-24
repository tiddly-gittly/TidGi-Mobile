/**
 * Cucumber.js config for Detox E2E tests.
 * Run via: pnpm detox test --configuration android.usb.debug
 *
 * Tag filtering examples:
 *   CUCUMBER_TAGS='@smoke'            – only smoke tests
 *   CUCUMBER_TAGS='@settings'         – only settings tests
 *   CUCUMBER_TAGS='@mobilesync'       – only desktop-sync tests
 *   CUCUMBER_TAGS='@smoke or @settings' – smoke + settings
 *   (default) all three suites
 */
module.exports = {
  default: {
    require: ['e2e/support/hooks.ts', 'e2e/stepDefinitions/**/*.ts'],
    paths: ['e2e/features/**/*.feature'],
    format: ['progress-bar', 'html:e2e/reports/cucumber-report.html'],
    formatOptions: { snippetInterface: 'async-await' },
    tags: process.env.CUCUMBER_TAGS ?? '@smoke or @settings or @mobilesync',
    loader: 'ts-node/esm',
    requireModule: ['ts-node/register'],
  },
};
