export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
