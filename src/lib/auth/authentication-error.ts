export class AuthenticationUnavailableError extends Error {
  constructor(message = "로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "AuthenticationUnavailableError";
  }
}
