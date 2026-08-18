@realdesktop
Feature: Authenticated Desktop sync with attached sub-workspaces

  Background:
    Given the app is on the main menu screen

  Scenario: Sync a change that exists only in a sub-workspace through its main workspace
    Given a fresh mock server wiki is imported
    And only the main workspace stores sync server configuration
    And a test tiddler is written to the first child workspace via adb
    Then the main workspace should show the child pending change
    And the sub-workspace manager should immediately show the child pending change
    When I return to the main menu and sync the main workspace
    Then the sync should complete successfully
    And the workspace should have zero unsynced changes
