@agentui @android
Feature: Android conversation controls
  Scenario: Conversation history and action menus return to the conversation
    Given the app has launched
    When I open the agent conversation
    And I open and dismiss conversation history
    And I open model parameters from the conversation menu
    And I return from conversation settings
    Then the compact conversation controls are visible

  Scenario: Multiline composer retains its text across keyboard dismissal
    Given the app has launched
    When I open the agent conversation
    And I type a multiline message without sending it
    Then the message composer and send action remain visible
    When I dismiss the keyboard and reopen the composer
    Then the multiline draft is retained

  Scenario: Conversation overlays retain an unsent draft
    Given the app has launched
    When I open the agent conversation
    And I type a multiline message without sending it
    And I dismiss the keyboard
    And I open and dismiss conversation history
    Then the multiline draft remains in the composer
    When I open model parameters from the conversation menu
    And I return from conversation settings
    Then the multiline draft is retained
