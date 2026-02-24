@smoke
Feature: Smoke tests - verify the app launches and core navigation works

  # These tests do NOT require a desktop connection.
  # They verify the app opens, renders the main screen, and basic navigation
  # between the MainMenu, Importer, and Settings screens functions correctly.

  Scenario: App launches and shows main menu
    Given the app has launched
    Then I should see the main menu screen
    And I should see the import wiki button
    And I should see the create workspace button
    And I should see the settings icon

  Scenario: Navigate to the importer screen
    Given the app has launched
    When I tap the import wiki button
    Then I should see the importer screen
    And I should see the QR scanner toggle button
    When I press back
    Then I should see the main menu screen

  Scenario: Navigate to settings screen
    Given the app has launched
    When I tap the settings icon
    Then I should see the settings screen
    And I should see the "UI & Interact" section
    And I should see the "TiddlyWiki" section
    And I should see the "Sync & Backup" section
    When I press back
    Then I should see the main menu screen

  Scenario: Settings screen shows theme controls
    Given the app has launched
    When I tap the settings icon
    Then I should see the settings screen
    And I should see the theme segmented buttons
    And I should see the translucent status bar toggle
    And I should see the hide status bar toggle

  Scenario: Settings screen shows TiddlyWiki user name field
    Given the app has launched
    When I tap the settings icon
    Then I should see the settings screen
    When I scroll down to "TiddlyWiki"
    Then I should see the username input field
