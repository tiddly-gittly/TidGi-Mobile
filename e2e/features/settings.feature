@settings
Feature: Settings - verify preference screens read and write correctly

  # These tests do NOT require a desktop connection.
  # Each scenario resets by relaunching the app so state is predictable.

  Background:
    Given the app has launched
    When I tap the settings icon
    Then I should see the settings screen

  # ── Theme ────────────────────────────────────────────────────────────────────

  @settings-theme
  Scenario: Switch theme to Dark and back to System Default
    Then I should see the theme segmented buttons
    When I tap the "Dark Theme" theme button
    Then the selected theme should be "Dark Theme"
    When I tap the "System Default" theme button
    Then the selected theme should be "System Default"

  @settings-theme
  Scenario: Switch theme to Light Theme
    Then I should see the theme segmented buttons
    When I tap the "Light Theme" theme button
    Then the selected theme should be "Light Theme"
    When I tap the "System Default" theme button
    Then the selected theme should be "System Default"

  # ── Status bar toggles ───────────────────────────────────────────────────────

  @settings-statusbar
  Scenario: Toggle Translucent Status Bar switch
    Then I should see the translucent status bar toggle
    When I toggle the translucent status bar switch
    Then the translucent status bar switch state should have changed
    When I toggle the translucent status bar switch
    Then the translucent status bar switch state should be restored

  @settings-statusbar
  Scenario: Toggle Hide Status Bar switch
    Then I should see the hide status bar toggle
    When I toggle the hide status bar switch
    Then the hide status bar switch state should have changed
    When I toggle the hide status bar switch
    Then the hide status bar switch state should be restored

  # ── TiddlyWiki user name ─────────────────────────────────────────────────────

  @settings-tiddlywiki
  Scenario: Set a custom user name in TiddlyWiki settings
    When I scroll down to "TiddlyWiki"
    Then I should see the username input field
    When I clear and type "TestUser" into the username field
    Then the username field should show "TestUser"
    When I clear and type "" into the username field

  # ── Language ─────────────────────────────────────────────────────────────────

  @settings-language
  Scenario: Settings screen shows language section
    When I scroll down to "Lang/语言"
    Then I should see the language section header

  # ── Workspace settings (requires at least one workspace) ─────────────────────

  @settings-workspace
  Scenario: Open workspace detail from main menu
    When I press back
    Then I should see the main menu screen
    Given at least one workspace exists
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    And I should see the workspace sync button
    And I should see the workspace general settings button

  @settings-workspace
  Scenario: Open workspace general settings page
    When I press back
    Then I should see the main menu screen
    Given at least one workspace exists
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace general settings button
    Then I should see the workspace settings page

  @settings-workspace
  Scenario: Navigate to workspace sync page from workspace detail
    When I press back
    Then I should see the main menu screen
    Given at least one workspace exists
    When I tap the settings icon on the first workspace
    Then I should see the workspace detail screen
    When I tap the workspace sync button
    Then I should see the workspace sync page
