@mobilesync @conflict
Feature: Conflict Resolution - Mobile and Desktop concurrent edits

  # Pre-condition: At least one wiki workspace exists with E2ETestTiddler.tid in its git history.
  # Run @import and @sync scenarios first to ensure the shared ancestor commit exists.
  #
  # The conflict flow:
  #   1. Desktop modifies E2ETestTiddler.tid body + commits (via file-system watcher auto-commit).
  #   2. Mobile modifies the SAME file differently (via adb) — diverged commit from the same ancestor.
  #   3. Mobile taps sync: gitCommit → gitPushToIncoming → triggerDesktopMerge → gitFetchAndReset.
  #   4. Desktop detects merge conflict → resolveTidConflictMarkers resolves it:
  #        header: mobile wins (newer modified timestamp)
  #        body: desktop + unique mobile lines merged
  #   5. Verify: desktop file contains BOTH body lines; mobile sync completes successfully.

  Background:
    Given the app is on the main menu screen
    And at least one wiki workspace exists

  @conflict
  Scenario: Body edits on both sides are merged; mobile header wins on conflict
    # Desktop adds a unique body line to E2ETestTiddler.tid and waits for file-watcher auto-commit.
    # Mobile independently overwrites the same tiddler with a different body line.
    # After sync, both body lines must be present and mobile's modified timestamp must win.
    Given the desktop appends "Desktop conflict line." to "E2ETestTiddler.tid" and commits
    When the mobile overwrites "E2ETestTiddler.tid" adding body line "Mobile conflict line."
    And I tap the sync button for the first wiki workspace
    Then the sync should complete successfully
    And the unsynced count should be zero after sync
    And the desktop tiddler "E2ETestTiddler.tid" body contains "Desktop conflict line."
    And the desktop tiddler "E2ETestTiddler.tid" body contains "Mobile conflict line."
    And the desktop tiddler "E2ETestTiddler.tid" header contains the mobile modified timestamp
