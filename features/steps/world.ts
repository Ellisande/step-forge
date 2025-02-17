import { setWorldConstructor } from "@cucumber/cucumber";
import { BasicWorld } from "../../src/world";

export interface GivenState {
  user: {
    type: string;
    token: string;
  };
}

export interface WhenState {
  user: {
    type: string;
    token: string;
    saved: boolean;
    age?: number;
  };
  deposit: {
    amount: number;
    currency: string;
    user: {
      type: string;
      token: string;
    };
  };
}

export interface ThenState {}

setWorldConstructor(BasicWorld<GivenState, WhenState, ThenState>);
