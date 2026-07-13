import { givenBuilder } from "./given";
import { thenBuilder } from "./then";
import { whenBuilder } from "./when";

/**
 * Pre-bound builders for one world type. Each entry is callable with a plain
 * string statement (`Given("a user")`) and carries the named-variable entry
 * point as a property (`Given.variables({...}).statement(v => ...)`).
 */
export const createBuilders = <GivenState, WhenState, ThenState>() => {
  const given = givenBuilder<GivenState>();
  const when = whenBuilder<GivenState, WhenState>();
  const then = thenBuilder<GivenState, WhenState, ThenState>();
  return {
    Given: given,
    When: when,
    Then: then,
  };
};
