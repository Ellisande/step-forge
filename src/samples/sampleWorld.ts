import { WorldState } from "../world";

import { MergeableWorldState } from "../world";

import { createMergeableState } from "../world";

export class World<Given, When, Then> {
  private givenState: WorldState<Given> = {};
  private whenState: WorldState<When> = {};
  private thenState: WorldState<Then> = {};

  public get given(): MergeableWorldState<Given> {
    return createMergeableState(this.givenState);
  }

  public get when(): MergeableWorldState<When> {
    return createMergeableState(this.whenState);
  }

  public get then(): MergeableWorldState<Then> {
    return createMergeableState(this.thenState);
  }
}
