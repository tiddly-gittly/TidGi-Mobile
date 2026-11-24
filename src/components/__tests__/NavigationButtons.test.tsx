import React from 'react';
import english from '../../i18n/localization/locales/en/translation.json';
import japanese from '../../i18n/localization/locales/ja/translation.json';
import chinese from '../../i18n/localization/locales/zh_CN/translation.json';
import { AgentChatButton, CreateWorkspaceButton } from '../NavigationButtons';

const mockNavigate = jest.fn();
let mockLabels = chinese;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key === 'AgentChat.Title' ? mockLabels.AgentChat.Title : mockLabels.AddWorkspace.AddWorkspace,
  }),
}));
jest.mock('react-native-paper', () => {
  const react = jest.requireActual<typeof React>('react');
  return {
    Button: (props: { children?: React.ReactNode }) => react.createElement('PaperButton', props, props.children),
    Text: (props: { children?: React.ReactNode }) => react.createElement('PaperText', props, props.children),
  };
});
jest.mock('styled-components/native', () => {
  const react = jest.requireActual<typeof React>('react');
  return {
    styled: (Component: React.ComponentType) => (rules: TemplateStringsArray) => (props: { children?: React.ReactNode }) =>
      react.createElement(Component, { ...props, styleRule: rules.join('') } as React.Attributes),
  };
});

interface ButtonNode {
  props: {
    mode: string;
    contentStyle: { minHeight: number };
    labelStyle: { padding: number };
    styleRule: string;
    testID: string;
    onPress(): void;
  };
}
interface TestRenderer {
  root: {
    findAllByType(type: 'PaperButton'): ButtonNode[];
    findAllByType(type: 'PaperText'): Array<{ props: { children: string } }>;
  };
  unmount(): void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));

let view: TestRenderer | undefined;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  mockNavigate.mockClear();
});
afterEach(async () => {
  await act(async () => {
    view?.unmount();
    await Promise.resolve();
  });
  view = undefined;
});

it.each(
  [
    ['Chinese', chinese, '智能体'],
    ['English', english, 'Agent'],
    ['Japanese', japanese, japanese.AgentChat.Title],
  ] as const,
)('uses the existing localized title and shared navigation-button sizing in %s', async (_locale, labels, title) => {
  mockLabels = labels as typeof chinese;
  await act(async () => {
    view = create(
      <>
        <AgentChatButton />
        <CreateWorkspaceButton />
      </>,
    );
    await Promise.resolve();
  });
  const [agent, workspace] = view!.root.findAllByType('PaperButton');
  expect(view!.root.findAllByType('PaperText')[0].props.children).toBe(title);
  for (const button of [agent, workspace]) {
    expect(button.props.mode).toBe('outlined');
    expect(button.props.contentStyle).toEqual({ minHeight: 56 });
    expect(button.props.labelStyle).toEqual({ padding: 15 });
    expect(button.props.styleRule.trim()).toBe('margin: 10px;');
  }
  agent.props.onPress();
  workspace.props.onPress();
  expect(mockNavigate.mock.calls).toEqual([['AgentChat'], ['CreateWorkspace']]);
});
