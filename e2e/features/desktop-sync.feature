@mobilesync
Feature: Mock Server Sync — import from mock TiddlyWiki, create tiddlers, sync back

  # A local TiddlyWiki instance with tw-mobile-sync plugin runs on localhost:5212.
  # The mock server is auto-started by hooks.ts BeforeAll.

  Background:
    Given the app is on the main menu screen

  @import
  Scenario: Import wiki from mock server
    When I navigate to the importer screen
    Then I should see the importer screen
    And the mock server is reachable
    When I enter the mock server URL
    And I tap the import wiki confirm button
    Then the import should complete successfully
    And I should see the imported wiki in the workspace list

  @sync
  Scenario: Open wiki and create a tiddler, then sync back to mock server
    Given a fresh mock server wiki is imported
    When I tap the first wiki workspace
    Then I should see the wiki webview
    And I wait 15 seconds for the wiki to fully load
    When I create a tiddler "E2ETestTiddler" via the wiki webview
    And I wait 10 seconds for the save to complete
    When I navigate back to the main menu
    And I wait 5 seconds for pending saves to complete
    When I tap the sync button for the first wiki workspace
    Then the sync should complete successfully
    And the unsynced count should be zero after sync
    And the mock server git working tree contains "E2ETestTiddler"
