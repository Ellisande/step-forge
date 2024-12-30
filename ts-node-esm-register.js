import { register } from "ts-node";

register({
  project: "./tsconfig.cucumber.json",
  esm: true,
  experimentalSpecifierResolution: "node",
  transpileOnly: true,
});
