@mobilesync
Feature: Data Safety - verify no corruption when saving new tiddlers

  # Regression test for the "parallelStream ordering bug" where
  # batchParseTidFiles could return results in non-deterministic order,
  # causing the file index to map wrong titles to wrong file paths.
  # Saving a new user tiddler would then trigger cleanup of the wrong
  # file, deleting system plugin tiddlers.
  #
  # Pre-condition: the Detox hooks start the local mock server automatically.
  # Each scenario imports a fresh mock wiki so it does not depend on scenario order.

  Background:
    Given the app is on the main menu screen

  @sync
  Scenario: Creating a new tiddler does not delete any existing files
    Given a fresh mock server wiki is imported
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 10 seconds for the wiki to fully load
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    Then the workspace git working tree should contain no deletions

  @sync
  Scenario: Saving a new user tiddler via adb does not corrupt the file index
    Given a fresh mock server wiki is imported
    And a test tiddler is written to the first wiki via adb
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 10 seconds for the wiki to fully load
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    Then the workspace git working tree should contain the newly added tiddler
    And the workspace git working tree should contain no deletions
