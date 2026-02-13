Feature: Analyzer dependency verification

  Background:
    Given step definitions from "steps.ts"

  # --- Passing scenarios ---

  Scenario: No dependencies produces no errors
    Given a feature file "valid-no-deps.feature"
    When I analyze the files
    Then there should be no errors

  Scenario: Satisfied required dependencies produce no errors
    Given a feature file "valid-deps.feature"
    When I analyze the files
    Then there should be no errors

  Scenario: Variables with satisfied dependencies produce no errors
    Given a feature file "valid-variables.feature"
    When I analyze the files
    Then there should be no errors

  Scenario: Optional dependencies not produced produce no errors
    Given a feature file "valid-optional-deps.feature"
    When I analyze the files
    Then there should be no errors

  Scenario: And/But keywords resolve correctly with satisfied deps
    Given a feature file "valid-and-but-keywords.feature"
    When I analyze the files
    Then there should be no errors

  # --- Failing scenarios ---

  Scenario: Missing required given dependency reports an error
    Given a feature file "missing-given-dep.feature"
    When I analyze the files
    Then there should be 1 errors
    And an error should mention "given.user"

  Scenario: Missing required when dependency reports an error
    Given a feature file "missing-when-dep.feature"
    When I analyze the files
    Then there should be 1 errors
    And an error should mention "when.user"

  Scenario: Multiple missing dependencies reports multiple errors
    Given a feature file "missing-multiple-deps.feature"
    When I analyze the files
    Then there should be 2 errors
