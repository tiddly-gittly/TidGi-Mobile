@remote-target
Feature: Remote target selection

  # This scenario is intentionally excluded from the default cucumber tag set.
  # It only verifies stable navigation and remote-target selection state.
  # It does not claim remote task execution, streaming, or tool results.
  #
  # Pre-condition: at least one connected MemeLoop node already exists in the
  # test app state before the scenario starts.

  Scenario: Select a connected node as the active remote target
    Given the app has launched
    And at least one connected MemeLoop node exists
    When I tap the Nodes tab
    Then I should see the node list screen
    When I tap the agent target control for the first connected node
    Then the first connected node should show as the active agent target
    When I tap the Agent tab
    Then I should see the agent conversation list screen
    And I should see the selected remote target summary
