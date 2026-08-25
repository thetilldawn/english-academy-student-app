export type StudentPointBalance = {
  studentId: string;
  currentPoints: number;
};

export type StudentAttemptPointSummary = {
  attemptPoints: number;
  currentPoints: number;
};

export type AdminAttemptPointSummary = {
  correctReward: number;
  wrongEffect: number;
  netChange: number;
  currentPoints: number;
};
