Feature: Variables with dependencies

  Scenario: Variables and satisfied deps
    Given a user named "John"
    When I save the user
    Then the user's name is "John"
