@mobilesync
Feature: Data Safety - verify no corruption when saving new tiddlers

  # Regression test for the "parallelStream ordering bug" where
  # batchParseTidFiles could return results in non-deterministic order,
  # causing the file index to map wrong titles to wrong file paths.
  # Saving a new user tiddler would then trigger cleanup of the wrong
  # file, deleting system plugin tiddlers.
  #
  # Pre-condition: A wiki workspace with system plugins must exist.

  Background:
    Given the app is on the main menu screen

  @sync
  Scenario: Creating a new tiddler via WebView does not delete any existing files
    Given at least one wiki workspace exists
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 15 seconds for the wiki to fully load
    When I create a tiddler "DataSafetyTestTiddler" via the wiki webview
    And I wait 10 seconds for the save to complete
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    Then the workspace system tiddlers count should remain unchanged

  @sync
  Scenario: Saving a new user tiddler via WebView does not corrupt the file index
    Given at least one wiki workspace exists
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 15 seconds for the wiki to fully load
    When I create a tiddler "DataSafetyTestTiddler" via the wiki webview
    And I wait 10 seconds for the save to complete
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    Then the workspace system tiddlers count should remain unchanged
