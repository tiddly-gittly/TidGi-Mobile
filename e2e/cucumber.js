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
    // Allow Detox waitFor() calls with up to 120 s to complete inside a step.
    // Some scenarios (wiki webview cold-start, git sync) take 30-90 s.
    // Individual steps that don't need this long still finish early.
    timeout: 120_000,
  },
};
