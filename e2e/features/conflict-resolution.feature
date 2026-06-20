@conflict
Feature: Conflict Resolution - Mobile and mock server concurrent edits

  # The conflict flow:
  #   1. Scenario imports a fresh mock wiki and creates E2ETestTiddler.tid.
  #   2. Mock server modifies E2ETestTiddler.tid body + commits explicitly.
  #   3. Mobile modifies the SAME file differently (via adb) — diverged commit from the same ancestor.
  #   4. Mobile taps sync: gitCommit → gitPushToIncoming → plugin merge → gitFetchAndReset.
  #   5. Plugin detects merge conflict → resolveTidConflictMarkers resolves it:
  #        header: mobile wins (newer modified timestamp)
  #        body: mock server + unique mobile lines merged
  #   6. Verify: mock server file contains BOTH body lines; mobile sync completes successfully.

  Background:
    Given the app is on the main menu screen

  @conflict
  Scenario: Body edits on both sides are merged; mobile header wins on conflict
    Given a fresh mock server wiki is imported
    And the imported mock server wiki has a synced tiddler "E2ETestTiddler" in shared history
    # Mock server adds a unique body line to E2ETestTiddler.tid and commits explicitly.
    # Mobile independently overwrites the same tiddler with a different body line.
    # After sync, both body lines must be present and mobile's modified timestamp must win.
    Given the mock server appends "Mock server conflict line." to "E2ETestTiddler.tid" and commits
    When the mobile overwrites "E2ETestTiddler.tid" adding body line "Mobile conflict line."
    And I tap the sync button for the first wiki workspace
    Then the sync should complete successfully
    And the unsynced count should be zero after sync
    And the mock server tiddler "E2ETestTiddler.tid" body contains "Mock server conflict line."
    And the mock server tiddler "E2ETestTiddler.tid" body contains "Mobile conflict line."
    And the mock server tiddler "E2ETestTiddler.tid" header contains the mobile modified timestamp