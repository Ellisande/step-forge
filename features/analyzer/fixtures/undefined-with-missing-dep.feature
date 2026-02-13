Feature: Undefined step with missing dependency
  Scenario: Has both undefined and missing dependency
    When I save the user
    When I do something that does not exist
    Then everything was good
