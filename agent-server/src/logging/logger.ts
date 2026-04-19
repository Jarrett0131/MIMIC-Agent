import { getRequestContext } from "./requestContext";

type StructuredLogPayload = Record<string, unknown>;

export function writeStructuredLog(
  event: string,
  payload: StructuredLogPayload = {},
): void {
  const requestContext = getRequestContext();

  console.log(
    JSON.stringify({
      event,
      request_id: payload.request_id ?? requestContext?.requestId,
      ...payload,
    }),
  );
}
