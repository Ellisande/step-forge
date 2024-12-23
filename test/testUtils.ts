import { createBasicWorld } from "../src/world";

export const sampleGivenState = {
  a: "stuff",
  b: "things",
  c: 3,
};
export type SampleGivenState = typeof sampleGivenState;

export const sampleWhenState = {
  d: 1,
  e: "other stuff",
  f: [3, 4, 5],
};
export type SampleWhenState = typeof sampleWhenState;

export const sampleThenState = {
  g: 1,
  h: 2,
  i: { j: "k" },
};
export type SampleThenState = typeof sampleThenState;

export const sampleWorld = createBasicWorld<
  SampleGivenState,
  SampleWhenState,
  SampleThenState
>();

export type SampleWorld = typeof sampleWorld;
