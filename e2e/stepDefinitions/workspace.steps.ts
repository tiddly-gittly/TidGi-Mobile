/**
 * Workspace navigation step definitions.
 *
 * Covers: workspace detail page, sync page, settings page, changes page.
 * These steps do NOT require a desktop connection — they only test UI navigation.
 *
 * Step definitions shared with desktop-sync scenarios are also defined here
 * (e.g. "at least one wiki workspace exists", "tap the workspace changes button").
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { by, element, expect as detoxExpect, waitFor } from 'detox';

const UI_TIMEOUT = 10_000;

// ── Guards ────────────────────────────────────────────────────────────────────

Given('at least one workspace exists', async () => {
  // The help workspace ('workspace-item-help') is always present after install.
  await waitFor(element(by.id('workspace-item-help')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

/** Matches a wiki workspace (type=wiki). The help workspace is type=webpage. */
Given('at least one wiki workspace exists', async () => {
  // workspace-item-help is type=webpage; wiki workspaces have a sync icon button.
  // We check for the existence of at least one sync-icon-button.
  await waitFor(element(by.label('sync-icon-button')).atIndex(0))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

// ── Workspace detail navigation ───────────────────────────────────────────────

When('I tap the settings icon on the first workspace', async () => {
  // accessibilityLabel='workspace-settings-icon' is set on every workspace settings icon.
  await element(by.label('workspace-settings-icon')).atIndex(0).tap();
});

Then('I should see the workspace detail screen', async () => {
  await waitFor(element(by.id('workspace-detail-screen')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the workspace sync button', async () => {
  await detoxExpect(element(by.id('workspace-sync-button'))).toBeVisible();
});

Then('I should see the workspace general settings button', async () => {
  await waitFor(element(by.id('workspace-general-settings-button')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

When('I tap the workspace sync button', async () => {
  await element(by.id('workspace-sync-button')).tap();
});

When('I tap the workspace general settings button', async () => {
  await element(by.id('workspace-general-settings-button')).tap();
});

When('I tap the workspace changes button', async () => {
  await element(by.id('workspace-changes-button')).tap();
});

// ── Sub-page assertions ───────────────────────────────────────────────────────

Then('I should see the workspace sync page', async () => {
  // WorkspaceSyncPage sets its title to t('Sync.WorkspaceSync') = '工作区同步'
  await waitFor(element(by.text('工作区同步')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the last sync timestamp', async () => {
  // The sync page always shows t('Sync.LastSync') = '上次同步' as a label.
  await waitFor(element(by.text('上次同步')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the workspace settings page', async () => {
  // WorkspaceSettingsPage title: t('WorkspaceSettings.Title') = '工作区设置'
  await waitFor(element(by.text('工作区设置')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the commit history page', async () => {
  // WorkspaceChangesPage title: t('GitHistory.Commits') = '提交历史'
  await waitFor(element(by.text('提交历史')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});

Then('I should see the unsynced commit count label', async () => {
  await waitFor(element(by.id('workspace-unsynced-count')))
    .toBeVisible()
    .withTimeout(UI_TIMEOUT);
});
