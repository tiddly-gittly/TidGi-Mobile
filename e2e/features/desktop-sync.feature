@mobilesync
Feature: Desktop Sync - Import and sync wiki from a running TidGi Desktop

  # Prerequisite: TidGi Desktop is already running and serving a workspace via
  # the tw-mobile-sync plugin. The desktop server URL is supplied via the
  # TIDGI_DESKTOP_URL environment variable (e.g. http://192.168.1.10:5212).

  Background:
    Given the app is on the main menu screen

  @import
  Scenario: Import wiki from desktop via saved server
    When I tap the import wiki button
    And I see the importer screen
    And the desktop server is reachable
    When I select the desktop server from the saved servers list
    Then the workspace name field should be filled
    When I tap the import wiki confirm button
    Then I should see the import progress
    And the import should complete successfully
    And I should see a button to open the imported wiki

  @import @open
  Scenario: Open imported wiki after successful import
    Given a wiki has already been imported from the desktop
    When I tap the open wiki button
    Then I should see the wiki webview

  @sync
  Scenario: Pull latest changes from desktop
    Given a wiki has already been imported from the desktop
    When I open the workspace sync page
    And I tap the pull from desktop button
    Then the pull should complete without error
    And the workspace sync status should show up to date
