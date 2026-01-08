export class SmolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmolTalkError";
  }
}
