@sync
Feature: Data Safety — verify creating a tiddler does not corrupt the file index

  # Regression test for the parallelStream ordering bug.
  # Uses the real TiddlyWiki WebView to create a tiddler, then
  # checks that no system plugin files were deleted.

  Background:
    Given the app is on the main menu screen

  Scenario: Create a tiddler via TiddlyWiki WebView and verify no files are deleted
    Given at least one wiki workspace exists
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 15 seconds for the wiki to fully load
    When I create a tiddler "E2E Safety Test" via the wiki webview
    And I wait 10 seconds for the save to complete
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    Then the workspace system tiddlers count should remain unchanged
