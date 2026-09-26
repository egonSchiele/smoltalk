export type Success<T> = {
  success: true;
  value: T;
};
export type Failure = {
  success: false;
  error: string;
  /** The HTTP status of the provider response, when the failure came from
   *  one. Lets a caller classify a 429 or a 5xx without parsing `error`. */
  status?: number;
};
export type Result<T> = Success<T> | Failure;

export function success<T>(value: T): Success<T> {
  return { success: true, value };
}

export function failure(error: string, fields?: { status?: number }): Failure {
  if (fields?.status === undefined) {
    return { success: false, error };
  }
  return { success: false, error, status: fields.status };
}

export function mergeResults<T>(results: Result<T>[]): Result<T[]> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.success) {
      return failure(result.error);
    }
    values.push(result.value);
  }
  return success(values);
}
