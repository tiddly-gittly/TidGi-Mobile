/**
 * Cucumber.js config for Detox E2E tests.
 * Run via: pnpm detox test --configuration android.usb.debug
 *
 * Tag filtering examples:
 *   CUCUMBER_TAGS='@smoke'              – only smoke tests
 *   CUCUMBER_TAGS='@settings'           – only settings tests
 *   CUCUMBER_TAGS='@workspace'          – only workspace navigation tests
 *   CUCUMBER_TAGS='@mobilesync'         – only desktop-sync tests (requires desktop)
 *   CUCUMBER_TAGS='@smoke or @settings' – smoke + settings
 *   (default) smoke + settings + workspace (no desktop required)
 */
module.exports = {
  default: {
    require: ['e2e/support/hooks.ts', 'e2e/stepDefinitions/**/*.ts'],
    paths: ['e2e/features/**/*.feature'],
    format: ['progress-bar', 'html:e2e/reports/cucumber-report.html'],
    formatOptions: { snippetInterface: 'async-await' },
    tags: process.env.CUCUMBER_TAGS ?? '@smoke or @settings or @workspace',
    loader: 'ts-node/esm',
    requireModule: ['ts-node/register'],
    // Allow Detox waitFor() calls with up to 30 s to complete inside a step.
    // Cucumber's built-in default is 5 000 ms which is shorter than cold-start
    // and element-wait timeouts used in step definitions.
    timeout: 30_000,
  },
};
