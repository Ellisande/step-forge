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

  Scenario: Named variables with int and custom parsers produce no errors
    Given a feature file "valid-parsers.feature"
    When I analyze the files
    Then there should be no errors

  # --- Undefined step scenarios ---

  Scenario: Undefined step reports an error
    Given a feature file "undefined-step.feature"
    When I analyze the files
    Then there should be 1 error
    And there is 1 error for rule "undefined-step"
    And an error should mention "I do something that does not exist"
    And an error should mention "does not match any step definition"

  Scenario: Undefined step combined with missing dependency
    Given a feature file "undefined-with-missing-dep.feature"
    When I analyze the files
    Then there should be 2 errors
    And there is 1 error for rule "undefined-step"
    And an error should mention "I do something that does not exist"
    And there is 1 error for rule "dependency-check"
    And an error should mention "given.user"

  Scenario: Step text that cannot satisfy the declared placeholders reports undefined steps
    Given a feature file "mismatched-parsers.feature"
    When I analyze the files
    Then there should be 2 errors
    And there are 2 errors for rule "undefined-step"
    And an error should mention "my favorite color is purple"
    And an error should mention "I deposit ten"

  # --- Ambiguous step scenarios ---

  Scenario: Ambiguous step reports an error
    Given a feature file "ambiguous-step.feature"
    When I analyze the files
    Then there should be 1 error
    And there is 1 error for rule "ambiguous-step"
    And an error should mention "matches multiple step definitions"

  # --- Failing scenarios ---

  Scenario: Missing required given dependency reports an error
    Given a feature file "missing-given-dep.feature"
    When I analyze the files
    Then there should be 1 error
    And there is 1 error for rule "dependency-check"
    And an error should mention "given.user"

  Scenario: Missing required when dependency reports an error
    Given a feature file "missing-when-dep.feature"
    When I analyze the files
    Then there should be 1 error
    And there is 1 error for rule "dependency-check"
    And an error should mention "when.user"

  Scenario: Multiple missing dependencies reports multiple errors
    Given a feature file "missing-multiple-deps.feature"
    When I analyze the files
    Then there should be 2 errors
    And there are 2 errors for rule "dependency-check"
    And an error should mention "given.user"
    And an error should mention "given.account"

  # --- Diagnostic range scenarios ---

  Scenario: Undefined step diagnostic range covers only the step text
    Given a feature file "undefined-step.feature"
    When I analyze the files
    Then there should be 1 error
    And the error on line 4 should span columns 10 to 44

  Scenario: Ambiguous step diagnostic range covers only the step text
    Given a feature file "ambiguous-step.feature"
    When I analyze the files
    Then there should be 1 error
    And the error on line 3 should span columns 11 to 30

  Scenario: Missing dependency diagnostic range covers only the step text
    Given a feature file "missing-given-dep.feature"
    When I analyze the files
    Then there should be 1 error
    And the error on line 4 should span columns 10 to 25

  Scenario: Each diagnostic range is correct with multiple errors
    Given a feature file "missing-multiple-deps.feature"
    When I analyze the files
    Then there should be 2 errors
    And the error on line 4 should span columns 10 to 25
    And the error on line 5 should span columns 10 to 30
