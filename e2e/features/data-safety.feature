@mobilesync
Feature: Data Safety — verify creating a tiddler does not corrupt the file index

  # Regression test for the parallelStream ordering bug where
  # batchParseTidFiles returned results in non-deterministic order,
  # causing the file index to map wrong titles to wrong file paths.
  # Saving a new user tiddler then deleted unrelated files (plugins).
  #
  # This scenario uses the real TiddlyWiki inside the WebView to
  # create a tiddler, triggering the full save→sync→file write pipeline.

  Background:
    Given the app is on the main menu screen

  @sync
  Scenario: Create a tiddler via TiddlyWiki WebView and verify no files are deleted
    Given at least one wiki workspace exists
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 15 seconds for the wiki to fully load
    When I create a tiddler "E2E Safety Test" via the wiki webview
    And I wait 10 seconds for the save to complete
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    Then the workspace git working tree should contain no deletions
