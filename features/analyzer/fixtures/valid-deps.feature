Feature: Satisfied dependencies

  Scenario: Full chain with required deps
    Given a user
    When I save the user
    Then there is a user
