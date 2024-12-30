const defaultProfile = {
  format: [
    process.env.CI || !process.stdout.isTTY ? "progress" : "progress-bar",
    "json:./reports/cucumber-json-reports/report.json",
    "rerun:./reports/cucumber/@rerun.txt",
    "usage:./reports/cucumber/usage.txt",
  ],
  parallel: 1,
  importModule: ["ts-node/esm", "tsconfig-paths/register"],
  import: [
    "./features/steps/**/*.ts",
    "./features/steps/*.ts",
    "./src/**/*.ts",
  ],
  strict: false,
};

const ciProfile = {
  format: [
    process.env.CI || !process.stdout.isTTY ? "progress" : "progress-bar",
    "json:./reports/cucumber-json-reports/report.json",
    "rerun:./reports/cucumber/@rerun.txt",
    "usage:./reports/cucumber/usage.txt",
  ],
  parallel: 1,
  importModule: ["ts-node/register/transpile-only", "tsconfig-paths/register"],
  import: ["./features/steps/**/*.ts", "./features/steps/*.ts"],
  strict: false,
  publish: true,
};

const all = {
  ...defaultProfile,
  paths: ["./features"],
};

export { ciProfile as ci, all };
export default defaultProfile;
