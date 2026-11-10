import React from 'react';

jest.mock('react-native', () => {
  const ReactModule = jest.requireActual<typeof React>('react');
  const View = ReactModule.forwardRef((props: { children?: React.ReactNode }, reference) => {
    ReactModule.useImperativeHandle(reference, () => ({
      measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
        callback(40, 80, 220, 260);
      },
    }));
    return ReactModule.createElement('View', props, props.children);
  });
  class Value {
    interpolate() {
      return 1;
    }
    removeAllListeners() {}
  }
  const animation = () => ({
    start: (callback?: (result: { finished: boolean }) => void) => {
      queueMicrotask(() => callback?.({ finished: true }));
    },
  });
  return {
    Animated: {
      View,
      Value,
      ValueXY: class {
        x = new Value();
        y = new Value();
        removeAllListeners() {}
      },
      timing: animation,
      parallel: animation,
    },
    Dimensions: { get: () => ({ width: 400, height: 800 }), addEventListener: () => ({ remove() {} }) },
    Easing: { bezier: () => undefined },
    findNodeHandle: () => null,
    I18nManager: { getConstants: () => ({ isRTL: false }) },
    Keyboard: { addListener: () => ({ remove() {} }) },
    NativeModules: {},
    Platform: { OS: 'android', select: (options: { android?: unknown; default?: unknown }) => options.android ?? options.default },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: <T,>(styles: T) => styles, absoluteFillObject: {} },
    View,
  };
});
jest.mock('react-native-paper/src/core/theming', () => {
  const theme = { animation: { scale: 1 }, roundness: 4, isV3: true, colors: { elevation: { level2: '#fff' } } };
  return { useInternalTheme: () => theme };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }),
}));
jest.mock('react-native-paper/src/components/Menu/MenuItem', () => 'MenuItem');
jest.mock('react-native-paper/src/components/Portal/Portal', () => {
  const ReactModule = jest.requireActual<typeof React>('react');
  return ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, {}, children);
});
jest.mock('react-native-paper/src/components/Surface', () => 'MenuSurface');
jest.mock('react-native-paper/src/utils/BackHandler/BackHandler', () => ({
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));
const { default: Menu } = jest.requireActual<{ default: typeof import('react-native-paper').Menu }>('react-native-paper/src/components/Menu/Menu');

interface TestRenderer {
  root: { findAllByType(type: string): unknown[] };
  update(element: React.ReactElement): void;
  unmount(): void;
}
const { create, act } = jest.requireActual<{
  create: (element: React.ReactElement) => TestRenderer;
  act: (callback: () => Promise<void>) => Promise<void>;
}>(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
const anchor = { x: 100, y: 80 };
let view: TestRenderer | undefined;
let previousAnimationFrame: typeof requestAnimationFrame;

async function flush(action: () => void) {
  await act(async () => {
    action();
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  previousAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => {
    queueMicrotask(() => {
      callback(0);
    });
    return 1;
  };
});
afterEach(async () => {
  await flush(() => {
    view?.unmount();
  });
  view = undefined;
  globalThis.requestAnimationFrame = previousAnimationFrame;
});

it('keeps the open menu visible when chat updates replace inline callbacks', async () => {
  await flush(() => {
    view = create(
      <Menu visible anchor={anchor} onDismiss={() => undefined}>
        <Menu.Item title='Goal' />
      </Menu>,
    );
  });
  expect(view?.root.findAllByType('MenuSurface')).toHaveLength(1);
  await flush(() => {
    view?.update(
      <Menu visible anchor={anchor} onDismiss={() => undefined}>
        <Menu.Item title='Goal' />
      </Menu>,
    );
  });
  expect(view?.root.findAllByType('MenuSurface')).toHaveLength(1);
});

it('reopens the conversation menu after closing it to show and leave a modal', async () => {
  const dismiss = () => undefined;
  await flush(() => {
    view = create(
      <Menu visible anchor={anchor} onDismiss={dismiss}>
        <Menu.Item title='Goal' />
      </Menu>,
    );
  });
  expect(view?.root.findAllByType('MenuSurface')).toHaveLength(1);
  await flush(() => {
    view?.update(
      <Menu visible={false} anchor={anchor} onDismiss={dismiss}>
        <Menu.Item title='Goal' />
      </Menu>,
    );
  });
  expect(view?.root.findAllByType('MenuSurface')).toHaveLength(0);
  await flush(() => {
    view?.update(
      <Menu visible anchor={anchor} onDismiss={dismiss}>
        <Menu.Item title='Goal' />
      </Menu>,
    );
  });
  expect(view?.root.findAllByType('MenuSurface')).toHaveLength(1);
});
