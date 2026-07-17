Feature: Skipped scenarios are not analyzed

  @skip
  Scenario: Deliberately broken but skipped
    Given a step that matches no definition
    Then there is a user

  Scenario: Valid scenario still analyzed
    Given a user
    When I save the user
    Then there is a user
