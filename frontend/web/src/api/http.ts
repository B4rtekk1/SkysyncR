export const NETWORK_ERROR_MESSAGE =
  'Could not connect to the server. Check your connection or make sure the API is running.'

export class NetworkError extends Error {
  constructor(message = NETWORK_ERROR_MESSAGE) {
    super(message)
    this.name = 'NetworkError'
  }
}

export function isNetworkError(err: unknown): err is NetworkError {
  return err instanceof NetworkError
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (err) {
    if (err instanceof TypeError) {
      throw new NetworkError()
    }

    throw err
  }
}
