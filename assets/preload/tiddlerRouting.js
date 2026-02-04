/**
 * Tiddler routing utilities for TidGi-Mobile
 * This file is injected into WebView to provide routing logic using TW's filter engine
 * 
 * Based on TidGi-Desktop's routingUtilities.ts
 */

/* global $tw */

(function () {
  'use strict';

  /**
   * Workspace configuration (simplified for mobile)
   */
  // IWorkspaceRouting structure:
  // { id, name, tagNames?, includeTagTree?, customFilters?, fileSystemPathFilters? }

  /**
   * Check if a tiddler matches direct tags
   */
  function matchesDirectTag(
    tiddlerTitle,
    tiddlerTags,
    workspaceTagNames
  ) {
    if (!workspaceTagNames || workspaceTagNames.length === 0) {
      return false;
    }

    // Check if any tiddler tag matches workspace tags
    const hasMatchingTag = workspaceTagNames.some(tagName => tiddlerTags.includes(tagName));
    
    // Check if tiddler title itself is one of the tag names (it's a "tag tiddler")
    const isTitleATagName = workspaceTagNames.includes(tiddlerTitle);

    return hasMatchingTag || isTitleATagName;
  }

  /**
   * Check if a tiddler matches tag tree (recursive tag hierarchy)
   */
  function matchesTagTree(
    tiddlerTitle,
    workspaceTagNames,
    wiki
  ) {
    if (!workspaceTagNames || workspaceTagNames.length === 0) {
      return false;
    }

    for (const tagName of workspaceTagNames) {
      try {
        // Use TW's in-tagtree-of filter operator
        const result = wiki.filterTiddlers(
          `[in-tagtree-of:inclusive[${tagName}]]`,
          null,
          wiki.makeTiddlerIterator([tiddlerTitle])
        );
        
        if (result.length > 0) {
          return true;
        }
      } catch (error) {
        console.error(`Error checking tag tree for ${tagName}:`, error);
      }
    }

    return false;
  }

  /**
   * Check if a tiddler matches custom filter expressions
   */
  function matchesCustomFilter(
    tiddlerTitle,
    filterExpression,
    wiki
  ) {
    if (!filterExpression || filterExpression.trim() === '') {
      return false;
    }

    // Split by newlines and try each filter
    const filters = filterExpression.split('\\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);

    for (const filter of filters) {
      try {
        const result = wiki.filterTiddlers(
          filter,
          null,
          wiki.makeTiddlerIterator([tiddlerTitle])
        );
        
        if (result.length > 0) {
          return true;
        }
      } catch (error) {
        console.error(`Error evaluating custom filter "${filter}":`, error);
      }
    }

    return false;
  }

  /**
   * Route a tiddler to the appropriate workspace
   * Returns workspace ID or undefined if no match (falls back to main workspace)
   */
  function routeTiddler(
    tiddlerTitle,
    tiddlerFields,
    workspaces
  ) {
    const wiki = $tw.wiki;
    const tiddlerTags = tiddlerFields.tags || [];

    // Check each workspace in order (priority)
    for (const workspace of workspaces) {
      // 1. Check direct tag match
      if (workspace.tagNames && workspace.tagNames.length > 0) {
        if (matchesDirectTag(tiddlerTitle, tiddlerTags, workspace.tagNames)) {
          return { workspaceId: workspace.id, workspaceName: workspace.name };
        }
      }

      // 2. Check tag tree match (if enabled)
      if (workspace.includeTagTree && workspace.tagNames && workspace.tagNames.length > 0) {
        if (matchesTagTree(tiddlerTitle, workspace.tagNames, wiki)) {
          return { workspaceId: workspace.id, workspaceName: workspace.name };
        }
      }

      // 3. Check custom filter match
      if (workspace.customFilters) {
        if (matchesCustomFilter(tiddlerTitle, workspace.customFilters, wiki)) {
          return { workspaceId: workspace.id, workspaceName: workspace.name };
        }
      }
    }

    // No match found, return undefined (will use main workspace)
    return undefined;
  }

  /**
   * Get relative file path for a tiddler in a workspace
   * Uses fileSystemPathFilters if available
   */
  function getTiddlerFilePath(
    tiddlerTitle,
    tiddlerFields,
    workspace
  ) {
    const wiki = $tw.wiki;
    
    // Try custom path filter first
    if (workspace.fileSystemPathFilters) {
      try {
        const result = wiki.filterTiddlers(
          workspace.fileSystemPathFilters,
          null,
          wiki.makeTiddlerIterator([tiddlerTitle])
        );
        
        if (result.length > 0 && result[0]) {
          return result[0];
        }
      } catch (error) {
        console.error(`Error evaluating file path filter:`, error);
      }
    }

    // Default: use sanitized title as filename
    const sanitized = tiddlerTitle.replace(/["#%&'*/:<=>?\\\\{}]/g, '_');
    return `tiddlers/${sanitized}.tid`;
  }

  // Expose functions to native layer via message passing
  if (typeof window !== 'undefined' && window.ReactNativeWebView) {
    window.tidgiMobileRouting = {
      routeTiddler,
      getTiddlerFilePath,
      matchesDirectTag,
      matchesTagTree,
      matchesCustomFilter,
    };
  }
})();
