Feature: Steps written in gherkin can be matched to Step Forge steps

    Scenario: Basic feature steps with no dependencies or variables can be run as a cucumber scenario
        Given I started
        When I got here
        Then everything was good

    Scenario: Basic feature steps with dependencies can be run as a cucumber scenario
        Given a user
        When I save the user
        Then there is a user

    Scenario: Basic feature steps with variables can be run as a cucumber scenario
        Given a user named "John"
        When I save the user
        Then there is a user

    Scenario: Brand new super secret step
        Given a user named "John"
        When I save the user
        Then there is a user

    Scenario: Basic feature steps with dependencies and variables can be run as a cucumber scenario
        Given a user
        When I name the user "John"
        Then the user's name is "John"

    Scenario: Feature steps with unquoted number variables can be run as a cucumber scenario
        Given a user
        When I deposit 100 "USD"
        Then the deposit amount is 100

    Scenario: Feature and scenario hooks run around a scenario
        Given I started
        Then the hooks have run

    Scenario: A custom parser introduces a new placeholder type
        Given my favorite color is green
        Then the favorite color is green
