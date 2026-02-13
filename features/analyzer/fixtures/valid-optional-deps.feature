Feature: Optional dependencies

  Scenario: Optional dep not produced is fine
    Given I started
    When I got here
    Then the account might exist
