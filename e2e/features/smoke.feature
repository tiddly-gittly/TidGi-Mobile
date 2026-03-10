@smoke
Feature: Smoke tests - verify the app launches and core navigation works

  # These tests do NOT require a desktop connection.
  # They verify the app opens, renders the main screen, and basic navigation
  # between the MainMenu and Settings screens functions correctly.

  Scenario: App launches and shows main menu
    Given the app has launched
    Then I should see the main menu screen
    And I should see the create workspace button
    And I should see the settings icon

  Scenario: Navigate to settings screen and back
    Given the app has launched
    When I tap the settings icon
    Then I should see the settings screen
    When I press back
    Then I should see the main menu screen
