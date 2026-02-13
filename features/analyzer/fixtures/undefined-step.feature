Feature: Undefined step
  Scenario: Uses an undefined step
    Given a user
    When I do something that does not exist
    Then everything was good
