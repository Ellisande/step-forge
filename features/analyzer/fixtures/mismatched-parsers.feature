Feature: Placeholder value mismatches

  Scenario: Values that do not fit the declared parsers
    Given a user
    And my favorite color is purple
    When I deposit ten "USD"
    Then everything was good
