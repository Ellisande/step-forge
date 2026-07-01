export interface GivenState {
  user: {
    type: string;
    token: string;
  };
  users: {
    name: string;
    age: number;
  }[];
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
