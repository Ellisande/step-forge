Feature: Missing given dependency

  Scenario: When step needs given.user but nothing produces it
    When I save the user
    Then everything was good
