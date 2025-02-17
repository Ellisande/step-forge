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

    Scenario: Basic feature steps with dependencies and variables can be run as a cucumber scenario
        Given a user
        When I name the user "John"
        Then the user's name is "John"

    Scenario: Basic feature steps number types can be run as a cucumber scenario
        Given a user
        When I set the user's age to 25
        Then the user's age is 25