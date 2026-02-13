Feature: And/But keyword resolution

  Scenario: And and But resolve correctly
    Given a user
    And an account
    When I save the user
    But I delete the account
    Then there is a user
