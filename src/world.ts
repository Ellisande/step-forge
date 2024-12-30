import _ from "lodash";

export type WorldState<State> = {
  readonly [K in keyof State]?: State[K];
};

export type MergeableWorldState<T> = WorldState<T> & {
  merge: (newState: Partial<T>) => void;
};

function mergeCustomizer(objValue: unknown, srcValue: unknown) {
  if (_.isArray(objValue)) {
    return objValue.concat(srcValue);
  } else if (objValue && !_.isPlainObject(objValue) && objValue !== srcValue) {
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
      state = _.merge({ ...state }, newState, mergeCustomizer);
    },
  };
};

export type MergeableWorld<Given, When, Then> = {
  given: MergeableWorldState<Given>;
  when: MergeableWorldState<When>;
  then: MergeableWorldState<Then>;
};

export class BasicWorld<Given, When, Then> {
  private givenState: WorldState<Given> = {};
  private whenState: WorldState<When> = {};
  private thenState: WorldState<Then> = {};

  public get given(): MergeableWorldState<Given> {
    return {
      ...this.givenState,
      merge: (newState: Partial<Given>) => {
        this.givenState = _.merge(
          { ...this.givenState },
          newState,
          mergeCustomizer
        );
      },
    };
  }

  public get when(): MergeableWorldState<When> {
    return {
      ...this.whenState,
      merge: (newState: Partial<When>) => {
        this.whenState = _.merge(
          { ...this.whenState },
          newState,
          mergeCustomizer
        );
      },
    };
  }

  public get then(): MergeableWorldState<Then> {
    return {
      ...this.thenState,
      merge: (newState: Partial<Then>) => {
        this.thenState = _.merge(
          { ...this.thenState },
          newState,
          mergeCustomizer
        );
      },
    };
  }
}

export const createBasicWorld = <Given, When, Then>(): MergeableWorld<
  Given,
  When,
  Then
> => {
  return new BasicWorld<Given, When, Then>();
};
