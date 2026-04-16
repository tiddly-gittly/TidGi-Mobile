/**
 * Remote target selection step definitions.
 *
 * These steps are intentionally narrow: they only verify that an existing
 * connected node can be selected as the agent target and that the selection is
 * reflected in stable UI state. They do not cover remote task execution.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import { execSync } from 'child_process';
import { by, element } from 'detox';
import { waitForElement } from '../support/diagnostics';

const UI_TIMEOUT = 10_000;
const APP_PACKAGE = 'ren.onetwo.tidgi.mobile.test';

const delay = (ms = 1_000) => new Promise((resolve) => setTimeout(resolve, ms));

function getNodeTestIdSuffix(nodeId: string): string {
  return nodeId.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function getFirstConnectedNodeId(): string | undefined {
  try {
    const raw = execSync(
      `adb shell run-as ${APP_PACKAGE} cat /data/data/${APP_PACKAGE}/files/persistStorage/memeloop-store`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const parsed = JSON.parse(raw) as {
      state?: { connectedPeers?: Array<{ nodeId?: string }> };
    };

    return parsed.state?.connectedPeers?.find(
      (peer) => typeof peer.nodeId === 'string',
    )?.nodeId;
  } catch {
    return undefined;
  }
}

Given('at least one connected MemeLoop node exists', () => {
  const nodeId = getFirstConnectedNodeId();
  if (!nodeId) {
    throw new Error(
      'No connected MemeLoop node found in device storage. Seed a connected node before running @remote-target scenarios.',
    );
  }
});

When('I tap the Nodes tab', async () => {
  await element(by.id('main-tab-nodes')).tap();
  await delay();
});

Then('I should see the node list screen', async () => {
  await waitForElement(
    by.id('node-list-screen'),
    UI_TIMEOUT,
    'node-list-screen',
    'visible',
  );
});

When(
  'I tap the agent target control for the first connected node',
  async () => {
    const nodeId = getFirstConnectedNodeId();
    if (!nodeId) {
      throw new Error(
        'Cannot tap the agent target control because no connected node was found.',
      );
    }

    const testIdSuffix = getNodeTestIdSuffix(nodeId);
    await waitForElement(
      by.id(`node-agent-target-button-${testIdSuffix}`),
      UI_TIMEOUT,
      `node-agent-target-button-${testIdSuffix}`,
      'visible',
    );
    await element(by.id(`node-agent-target-button-${testIdSuffix}`)).tap();
    await delay();
  },
);

Then(
  'the first connected node should show as the active agent target',
  async () => {
    const nodeId = getFirstConnectedNodeId();
    if (!nodeId) {
      throw new Error(
        'Cannot verify the active agent target because no connected node was found.',
      );
    }

    const testIdSuffix = getNodeTestIdSuffix(nodeId);
    await waitForElement(
      by.id(`node-agent-target-chip-${testIdSuffix}`),
      UI_TIMEOUT,
      `node-agent-target-chip-${testIdSuffix}`,
      'visible',
    );
  },
);

When('I tap the Agent tab', async () => {
  await element(by.id('main-tab-agent')).tap();
  await delay();
});

Then('I should see the agent conversation list screen', async () => {
  await waitForElement(
    by.id('agent-conversation-list-screen'),
    UI_TIMEOUT,
    'agent-conversation-list-screen',
    'visible',
  );
});

Then('I should see the selected remote target summary', async () => {
  const nodeId = getFirstConnectedNodeId();
  if (!nodeId) {
    throw new Error(
      'Cannot verify the selected remote target summary because no connected node was found.',
    );
  }

  const testIdSuffix = getNodeTestIdSuffix(nodeId);
  await waitForElement(
    by.id('agent-remote-target-summary'),
    UI_TIMEOUT,
    'agent-remote-target-summary',
    'visible',
  );
  await waitForElement(
    by.id(`agent-remote-target-label-${testIdSuffix}`),
    UI_TIMEOUT,
    `agent-remote-target-label-${testIdSuffix}`,
    'visible',
  );
});
