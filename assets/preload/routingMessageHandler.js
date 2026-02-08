/**
 * WebView message handler for tiddler routing
 * Handles communication between native layer and TiddlyWiki filter engine
 */

/* global $tw */

(function() {
  'use strict';

  // Load tidgi.config.json for each workspace
  const workspaceConfigs = new Map();

  /**
   * Load workspace configuration
   */
  async function loadWorkspaceConfig(workspaceId) {
    if (workspaceConfigs.has(workspaceId)) {
      return workspaceConfigs.get(workspaceId);
    }

    // Request config from native layer
    return new Promise((resolve) => {
      const messageId = `load-config-${Date.now()}`;
      
      const handleMessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.messageId === messageId) {
            window.removeEventListener('message', handleMessage);
            document.removeEventListener('message', handleMessage);
            workspaceConfigs.set(workspaceId, data.config);
            resolve(data.config);
          }
        } catch (error) {
          // Ignore
        }
      };

      window.addEventListener('message', handleMessage);
      document.addEventListener('message', handleMessage);

      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'getWorkspaceConfig',
        messageId,
        payload: { workspaceId },
      }));

      // Timeout
      setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        document.removeEventListener('message', handleMessage);
        resolve({});
      }, 3000);
    });
  }

  /**
   * Handle routing request from native layer
   */
  async function handleRouteTiddlerMessage(message) {
    const { messageId, payload } = message;
    const { title, fields, workspaceId, workspaces } = payload;

    try {
      // Load configs for all workspaces
      const configs = await Promise.all(
        workspaces.map(async (ws) => ({
          ...ws,
          config: await loadWorkspaceConfig(ws.id),
        }))
      );

      // Use routing logic from tiddlerRouting.js
      const result = window.tidgiMobileRouting.routeTiddler(
        title,
        fields,
        configs
      );

      // Send result back to native
      window.ReactNativeWebView.postMessage(JSON.stringify({
        messageId,
        result,
      }));
    } catch (error) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        messageId,
        error: error.message,
      }));
    }
  }

  /**
   * Handle file path request from native layer
   */
  async function handleGetFilePathMessage(message) {
    const { messageId, payload } = message;
    const { title, fields, workspaceId } = payload;

    try {
      const config = await loadWorkspaceConfig(workspaceId);
      
      const workspace = { id: workspaceId, config };
      const path = window.tidgiMobileRouting.getTiddlerFilePath(
        title,
        fields,
        workspace
      );

      window.ReactNativeWebView.postMessage(JSON.stringify({
        messageId,
        result: { path },
      }));
    } catch (error) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        messageId,
        error: error.message,
      }));
    }
  }

  /**
   * Listen for messages from native layer
   * Listen on both window and document for cross-platform React Native WebView compatibility
   */
  function onMessage(event) {
    try {
      const message = JSON.parse(event.data);
      
      switch (message.type) {
        case 'routeTiddler':
          handleRouteTiddlerMessage(message);
          break;
        case 'getTiddlerFilePath':
          handleGetFilePathMessage(message);
          break;
        case 'invalidateConfigCache':
          // Allow native layer to invalidate cached configs when they change
          if (message.payload && message.payload.workspaceId) {
            workspaceConfigs.delete(message.payload.workspaceId);
          } else {
            workspaceConfigs.clear();
          }
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage);

  // Signal that routing handler is ready
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'routingHandlerReady',
    }));
  }
})();
