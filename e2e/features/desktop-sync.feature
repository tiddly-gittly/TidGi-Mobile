@mobilesync
Feature: Desktop Sync - Import, create changes, and sync wiki through the local mock server

  # Pre-condition: the Detox hooks start the local mock server automatically.
  # Override TIDGI_DESKTOP_URL only when you intentionally want the device to
  # connect to a different reachable host/port.
  #
  # Scenarios tagged @import expect NO wiki to exist yet (clean device).
  # Scenarios tagged @sync and @open expect at least one wiki workspace to exist.

  Background:
    Given the app is on the main menu screen

  # ── Import ────────────────────────────────────────────────────────────────────

  @import
  Scenario: Import wiki from the mock server via QR / URL
    When I navigate to the importer screen
    Then I should see the importer screen
    And the mock server is reachable
    When I enter the mock server URL
    And I tap the import wiki confirm button
    Then the import should complete successfully
    And I should see the imported wiki in the workspace list

  # ── Open ──────────────────────────────────────────────────────────────────────

  @open
  Scenario: Open imported wiki in webview
    Given a fresh mock server wiki is imported
    When I tap the first wiki workspace
    Then I should see the wiki webview

  # ── Sync ──────────────────────────────────────────────────────────────────────

  @sync
  Scenario: View workspace sync status and last sync time
    Given a fresh mock server wiki is imported
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace sync button
    Then I should see the workspace sync page
    And I should see the last sync timestamp

  @sync
  Scenario: View commit history from workspace detail
    Given a fresh mock server wiki is imported
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace changes button
    Then I should see the commit history page

  @sync
  Scenario: Create a tiddler and sync changes to desktop
    Given a fresh mock server wiki is imported
    And a test tiddler is written to the first wiki via adb
    When I tap the sync button for the first wiki workspace
    Then the sync should complete successfully
    And the unsynced count should be zero after sync
