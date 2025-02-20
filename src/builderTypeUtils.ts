/* eslint-disable @typescript-eslint/no-explicit-any */
export type StepType = "given" | "when" | "then";

export type InferAndReplace<T, U> = never extends T ? U : T;

export type HasKeys<T> =
  T extends Record<any, any> ? (keyof T extends never ? never : T) : T;

export type EmptyObject = Record<string, never>;

export type RequiredOrOptional<T> = {
  [K in keyof T]?: "required" | "optional";
};

export type GetFunctionArgs<T> = T extends (...args: infer A) => any
  ? A
  : never;

export const isString = (
  statement: string | ((...args: [...any]) => string)
): statement is string => typeof statement === "string";

export type EmptyDependencies = {
  given: EmptyObject;
  when: EmptyObject;
  then: EmptyObject;
};