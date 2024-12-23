import { merge, isArray, isPlainObject } from "lodash";

export type WorldState<State> = {
  readonly [K in keyof State]?: State[K];
};

export type MergeableWorldState<T> = WorldState<T> & {
  merge: (newState: Partial<T>) => void;
};

function mergeCustomizer(objValue: unknown, srcValue: unknown) {
  if (isArray(objValue)) {
    return objValue.concat(srcValue);
  } else if (objValue && !isPlainObject(objValue) && objValue !== srcValue) {
    throw new Error(
      `Merge would have destroyed previous value ${objValue} with ${srcValue}`
    );
  }
  return objValue;
}

export const createMergeableState = <T>(
  state: WorldState<T>
): MergeableWorldState<T> => {
  return {
    ...state,
    merge: (newState: Partial<T>) => {
      state = merge({ ...state }, newState, mergeCustomizer);
    },
  };
};

export type MergeableWorld<Given, When, Then> = {
  given: MergeableWorldState<Given>;
  when: MergeableWorldState<When>;
  then: MergeableWorldState<Then>;
};

class BasicWorld<Given, When, Then> {
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

export const createBasicWorld = <Given, When, Then>(): MergeableWorld<
  Given,
  When,
  Then
> => {
  return new BasicWorld<Given, When, Then>();
};
