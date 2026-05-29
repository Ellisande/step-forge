import { givenBuilder } from "./given";
import { thenBuilder } from "./then";
import { whenBuilder } from "./when";

export const createBuilders = <GivenState, WhenState, ThenState>() => {
  return {
    Given: givenBuilder<GivenState>().statement,
    When: whenBuilder<GivenState, WhenState>().statement,
    Then: thenBuilder<GivenState, WhenState, ThenState>().statement,
  };
};
