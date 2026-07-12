import { BasicWorld } from "../../src/world";
import { GivenState, WhenState, ThenState } from "./world";

/**
 * World factory used by the native Step Forge runtime (one fresh world per
 * scenario). Mirrors the `setWorldConstructor(BasicWorld)` wiring that the
 * Cucumber adapter uses in `./world.ts`.
 */
export default () => new BasicWorld<GivenState, WhenState, ThenState>();
