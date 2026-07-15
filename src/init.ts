import { givenBuilder } from "./given";
import { thenBuilder } from "./then";
import { whenBuilder } from "./when";

/**
 * Pre-bound builders for one world type: `Given.statement("a user")` for
 * plain statements, `Given.variables({...}).statement(v => ...)` for
 * statements with variables.
 */
export const createBuilders = <GivenState, WhenState, ThenState>() => {
  return {
    Given: givenBuilder<GivenState>(),
    When: whenBuilder<GivenState, WhenState>(),
    Then: thenBuilder<GivenState, WhenState, ThenState>(),
  };
};
