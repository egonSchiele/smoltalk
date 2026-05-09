export class SmolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmolTalkError";
  }
}

export class SmolStructuredOutputError extends SmolError {
  constructor(message: string) {
    super(message);
    this.name = "SmolStructuredOutputError";
  }
}

export class SmolTimeoutError extends SmolError {
  constructor(message: string) {
    super(message);
    this.name = "SmolTimeoutError";
  }
}

export class SmolContentPolicyError extends SmolError {
  constructor(message: string) {
    super(message);
    this.name = "SmolContentPolicyError";
  }
}

export class SmolContextWindowExceededError extends SmolError {
  constructor(message: string) {
    super(message);
    this.name = "SmolContextWindowExceededError";
  }
}
