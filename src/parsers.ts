export type Parser<T> = {
    parse: (value: string) => T;
    gherkin: string;
  };

export const stringParser: Parser<string> = {
  parse: (value: string) => value,
  gherkin: "{string}",
};

export const intParser: Parser<number> = {
  parse: (value: string) => parseInt(value, 10),
  gherkin: "{int}",
};

export const numberParser: Parser<number> = {
  parse: (value: string) => parseFloat(value),
  gherkin: "{double}",
};


export const booleanParser: Parser<boolean> = {
  parse: (value: string) => value === "true",
  gherkin: "{string}",
};

