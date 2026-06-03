import test from 'node:test';
import assert from 'node:assert';

import AIClient from './utils/ai-util.js';

function mockAiFetch(responsePayload, inspectRequest = () => {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    inspectRequest(url, options);
    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('AI verify should accept DeepSeek reasoning-only length responses as connectivity success', async () => {
  const fetchMock = mockAiFetch({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: '',
        reasoning_content: '用户只是测试连通性，应该回复 OK。',
      },
      finish_reason: 'length',
    }],
  });

  try {
    const client = new AIClient({
      apiKey: 'test-key',
      baseURL: 'https://deepseek.example/v1',
      model: 'deepseek-reasoner',
    });

    const status = await client.verify();

    assert.equal(status.ok, true);
    assert.match(status.reply, /测试连通性|OK|用户只是测试连通性/);
    assert.equal(fetchMock.calls.length, 1);
    const body = JSON.parse(fetchMock.calls[0].options.body);
    assert.equal(body.model, 'deepseek-reasoner');
    assert.ok(body.max_tokens >= 16, 'connection test should not use a 1-token cap for reasoning models');
  } finally {
    fetchMock.restore();
  }
});

test('AI business chat should still reject reasoning-only responses without final content', async () => {
  const fetchMock = mockAiFetch({
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        reasoning_content: '{"reason":"thinking only, not final JSON"}',
      },
      finish_reason: 'length',
    }],
  });

  try {
    const client = new AIClient({
      apiKey: 'test-key',
      baseURL: 'https://deepseek.example/v1',
      model: 'deepseek-reasoner',
    });

    await assert.rejects(
      () => client.ask('请返回最终 JSON', { maxTokens: 64 }),
      /无法解析 AI 响应文本|AI 调用失败/,
    );
  } finally {
    fetchMock.restore();
  }
});
