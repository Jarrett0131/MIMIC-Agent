import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

describe("llmClient", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      LLM_ENABLED: "true",
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      LLM_BASE_URL: "",
      DEEPSEEK_API_KEY: "test-key",
      DASHSCOPE_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "",
      OPENAI_BASE_URL: "",
      LLM_TIMEOUT_MS: "8000",
      LLM_RETRY_TIMES: "1",
    };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("reads deepseek config and calls the OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const llmClient = await import("../src/services/llmClient");
    const availability = llmClient.getLlmAvailability();

    expect(availability).toMatchObject({
      enabled: true,
      provider: "deepseek",
      model: "deepseek-chat",
      timeout_ms: 8000,
      retry_times: 1,
    });

    await llmClient.generateLlmText(
      [
        {
          role: "user",
          content: "hello",
        },
      ],
      {
        operation: "llm_client_test",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("keeps aliyun provider support", async () => {
    process.env = {
      LLM_ENABLED: "true",
      LLM_PROVIDER: "aliyun",
      LLM_API_KEY: "aliyun-key",
      LLM_MODEL: "qwen-plus",
      LLM_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      LLM_TIMEOUT_MS: "8000",
      LLM_RETRY_TIMES: "1",
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "ok",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const llmClient = await import("../src/services/llmClient");
    const availability = llmClient.getLlmAvailability();

    expect(availability).toMatchObject({
      enabled: true,
      provider: "aliyun",
      model: "qwen-plus",
      timeout_ms: 8000,
      retry_times: 1,
    });

    await llmClient.generateLlmText(
      [
        {
          role: "user",
          content: "hello",
        },
      ],
      {
        operation: "llm_client_test_aliyun",
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer aliyun-key");
  });

  it("retries when JSON schema validation fails and succeeds on the correction attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"wrong":"shape"}',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"rewritten_question":"What is the latest heart rate?","changed":true}',
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const llmClient = await import("../src/services/llmClient");
    const result = await llmClient.generateLlmJson(
      [
        {
          role: "user",
          content: "rewrite this question",
        },
      ],
      {
        operation: "llm_json_schema_retry_test",
      },
      {
        name: "rewrite_payload",
        description:
          'An object with rewritten_question:string and changed:boolean.',
        validate: (
          value: unknown,
        ): value is { rewritten_question: string; changed: boolean } =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { rewritten_question?: unknown }).rewritten_question === "string" &&
          typeof (value as { changed?: unknown }).changed === "boolean",
      },
    );

    expect(result.data).toEqual({
      rewritten_question: "What is the latest heart rate?",
      changed: true,
    });
    expect(result.attempt_count).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const secondBody = JSON.parse(String(secondRequest.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondBody.messages).toHaveLength(3);
    expect(secondBody.messages[2]?.content).toContain("Schema name: rewrite_payload.");
  });

  it("falls back to the next provider when the primary provider fails permanently", async () => {
    process.env = {
      LLM_ENABLED: "true",
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "",
      LLM_MODEL: "",
      LLM_BASE_URL: "",
      LLM_FALLBACK_PROVIDERS: "aliyun",
      LLM_TIMEOUT_MS: "8000",
      LLM_RETRY_TIMES: "0",
      DEEPSEEK_API_KEY: "deepseek-key",
      DASHSCOPE_API_KEY: "aliyun-key",
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":{"message":"bad key"}}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "fallback ok",
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const llmClient = await import("../src/services/llmClient");
    const result = await llmClient.generateLlmText(
      [
        {
          role: "user",
          content: "hello",
        },
      ],
      {
        operation: "llm_provider_fallback_test",
      },
    );

    expect(result.provider).toBe("aliyun");
    expect(result.fallback_used).toBe(true);
    expect(result.text).toBe("fallback ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("streams text from an OpenAI-compatible SSE response", async () => {
    const streamChunks = [
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
      "data: [DONE]\n\n",
    ];

    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        streamChunks.forEach((chunk) => {
          controller.enqueue(new TextEncoder().encode(chunk));
        });
        controller.close();
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: responseBody,
    });
    vi.stubGlobal("fetch", fetchMock);

    const llmClient = await import("../src/services/llmClient");
    const deltas: string[] = [];
    const result = await llmClient.generateLlmTextStream(
      [
        {
          role: "user",
          content: "hello",
        },
      ],
      {
        onDelta: (delta) => {
          deltas.push(delta);
        },
      },
      {
        operation: "llm_stream_test",
      },
    );

    expect(deltas).toEqual(["he", "llo"]);
    expect(result.text).toBe("hello");
    expect(result.streamed).toBe(true);
    expect(result.usage).toMatchObject({
      total_tokens: 6,
      estimated: false,
    });
  });
});
