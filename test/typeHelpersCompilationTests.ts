import type { StateFromDependencies } from "../src/typeHelpers";

type SampleGivenState = {
  a: string;
  b: number;
  c: boolean;
};

type SampleGivenDependencies = {
  a: "required";
  b: "optional";
  f: "optional";
};

type SampleGivenStateFromDependencies = StateFromDependencies<
  SampleGivenState,
  SampleGivenDependencies
>;

type ExpectedOutput = {
  a: string;
  b?: number;
};

const _expected: ExpectedOutput = {} as SampleGivenStateFromDependencies;
const _actual: SampleGivenStateFromDependencies = {} as ExpectedOutput;

export { _expected, _actual };
