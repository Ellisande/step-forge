Feature: Builders can be re-exported for ease of use

    Scenario: Exported steps can be used in cucumber scenarios
        Given a bank user
        When I deposit "1000" "USD"
        Then the balance is "1000"