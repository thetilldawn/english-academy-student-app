export const STUDENT_SESSION_DAYS = 60;
export const STUDENT_SESSION_MAX_AGE_SECONDS =
  STUDENT_SESSION_DAYS * 24 * 60 * 60;

export const STUDENT_COOKIE_PRODUCTION = "__Host-ea_student_session";
export const STUDENT_COOKIE_DEVELOPMENT = "ea_student_session";

export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_FAILURES_PER_CODE = 5;
export const LOGIN_MAX_FAILURES_PER_IP = 10;
