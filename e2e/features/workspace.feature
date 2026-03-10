@workspace
Feature: Workspace detail, sync and settings navigation

  # These tests do NOT require a desktop connection.
  # Each scenario begins with the app on the main menu, resets automatically
  # via the Before hook, and navigates to WorkspaceDetailPage via the settings
  # icon on the first wiki workspace.
  #
  # Pre-condition: at least one wiki workspace is installed on the device.

  Background:
    Given the app has launched
    And at least one wiki workspace exists

  Scenario: Workspace detail page shows all action buttons
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    And I should see the workspace sync button
    And I should see the workspace general settings button

  Scenario: Navigate to workspace general settings page
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace general settings button
    Then I should see the workspace settings page

  Scenario: Navigate to workspace sync page
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace sync button
    Then I should see the workspace sync page

  Scenario: Navigate to workspace changes page
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace changes button
    Then I should see the commit history page
