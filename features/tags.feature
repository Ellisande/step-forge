Feature: Tags and scenario outlines map onto Vitest

  Scenario: A normal scenario runs
    Given I started
    When I got here
    Then everything was good

  @skip
  Scenario: A skipped scenario is never executed
    # `there is a user` requires a saved when.user; this would throw the missing
    # dependency error if it ran, so a green suite proves @skip took effect.
    Given a user
    Then there is a user

  Scenario Outline: Deposits of various amounts are recorded
    Given a user
    When I deposit <amount> "<currency>"
    Then the deposit amount is <amount>

    Examples:
      | amount | currency |
      | 100    | USD      |
      | 250    | EUR      |
