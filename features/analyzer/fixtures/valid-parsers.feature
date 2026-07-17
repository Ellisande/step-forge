Feature: Named variable placeholders

  Scenario: Unquoted int and custom color placeholders match their steps
    Given a user
    And my favorite color is red
    When I deposit 100 "USD"
    Then everything was good
