export type Color = "red" | "green" | "blue";

export interface GivenState {
  user: {
    type: string;
    token: string;
  };
  favoriteColor: Color;
}

export interface WhenState {
  user: {
    type: string;
    token: string;
    saved: boolean;
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
