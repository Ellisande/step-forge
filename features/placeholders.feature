Feature: Statement variables map to Cucumber expression placeholders

    Scenario: Variables default to the string placeholder when no parsers are provided
        Then a step with a variable and no parsers uses the string placeholder

    Scenario: Variables use the parser placeholder when parsers are provided
        Then a step with an int parser uses the int placeholder

    Scenario: Values are not coerced when no parsers are provided
        Then an unparsed value of "100" is a string
