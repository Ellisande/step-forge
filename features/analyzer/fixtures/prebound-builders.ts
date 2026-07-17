// Pre-bound builders re-exported for the "Simpler Step Definitions" style, used
// by prebound-steps.ts across the module boundary. The analyzer must follow the
// import alias back here to recover each builder's step phase.
import { givenBuilder } from "../../../src/given";
import { whenBuilder } from "../../../src/when";
import { thenBuilder } from "../../../src/then";

type GivenState = { user: { name: string } };
type WhenState = { order: { id: string } };
type ThenState = Record<string, never>;

export const Given = givenBuilder<GivenState>().statement;
export const When = whenBuilder<GivenState, WhenState>().statement;
export const Then = thenBuilder<GivenState, WhenState, ThenState>().statement;
