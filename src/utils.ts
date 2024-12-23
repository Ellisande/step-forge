import { MergeableWorld } from "./world";

export const requireFromGiven = <G>(
  keys: (keyof G)[],
  world: MergeableWorld<G, unknown, unknown>
) => {
  keys.forEach(key => {
    if (!world.given[key]) {
      throw new Error(`Key ${String(key)} is required in given state`);
    }
  });
  return keys.reduce(
    (acc, key) => {
      return {
        ...acc,
        [key]: world.given[key],
      };
    },
    {} as { [key in keyof G]: G[key] }
  );
};
export const requireFromWhen = <W>(
  keys: (keyof W)[],
  world: MergeableWorld<unknown, W, unknown>
) => {
  keys.forEach(key => {
    if (!world.when[key]) {
      throw new Error(`Key ${String(key)} is required in when state`);
    }
  });
  return keys.reduce(
    (acc, key) => {
      return {
        ...acc,
        [key]: world.when[key],
      };
    },
    {} as { [key in keyof W]: W[key] }
  );
};
export const requireFromThen = <T>(
  keys: (keyof T)[],
  world: MergeableWorld<unknown, unknown, T>
) => {
  keys.forEach(key => {
    if (!world.then[key]) {
      throw new Error(`Key ${String(key)} is required in then state`);
    }
  });
  return keys.reduce(
    (acc, key) => {
      return {
        ...acc,
        [key]: world.then[key],
      };
    },
    {} as { [key in keyof T]: T[key] }
  );
};
