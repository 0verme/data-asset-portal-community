import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeApiError } from './errorNormalizer.ts';

interface HttpError extends Error {
  status?: number;
  payload?: unknown;
}

function httpError(status: number, payload?: unknown, message = `请求失败: ${status}`): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  if (payload !== undefined) error.payload = payload;
  return error;
}

test('normalizer preserves the ErrorEnvelope and extracts known structured fields and indexes', () => {
  const details = [
    { field: 'db_type', message: 'database type is invalid' },
    { loc: ['body', 'params', 2, 'name'], msg: 'parameter name is invalid' },
    { field: 'responseFields.0.name', message: 'response field name is invalid' },
    { field: 'path.url', message: 'nested path property is invalid' },
  ];
  const error = httpError(422, {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'The submitted form is invalid',
      details,
    },
  });

  const normalized = normalizeApiError(error);
  assert.equal(normalized.kind, 'validation');
  assert.equal(normalized.status, 422);
  assert.equal(normalized.code, 'VALIDATION_ERROR');
  assert.equal(normalized.message, 'The submitted form is invalid');
  assert.deepEqual(normalized.details, details);
  assert.equal(normalized.safeMessage, '提交内容未通过校验，请检查表单后重试。');
  assert.deepEqual(normalized.fieldIssues, [
    { field: 'dbType', index: null, label: '数据库类型' },
    { field: 'params', index: 2, label: '请求参数' },
    { field: 'responseFields', index: 0, label: '响应字段' },
    { field: 'path', index: null, label: '请求路径' },
  ]);
});

test('normalizer classifies common HTTP failure statuses with safe messages', () => {
  const cases = [
    [401, 'unauthorized', '登录状态已失效，请重新登录。'],
    [403, 'forbidden', '当前账号没有执行此操作的权限。'],
    [409, 'conflict', '当前数据存在冲突，请检查后重试。'],
    [422, 'validation', '提交内容未通过校验，请检查表单后重试。'],
    [500, 'server', '服务暂时不可用，请稍后重试。'],
  ] as const;

  for (const [status, kind, safeMessage] of cases) {
    const normalized = normalizeApiError(httpError(status));
    assert.equal(normalized.status, status);
    assert.equal(normalized.kind, kind);
    assert.equal(normalized.safeMessage, safeMessage);
  }
});

test('normalizer supports legacy detail payloads and FastAPI loc arrays', () => {
  const detail = { loc: ['body', 'unload_times', 1], msg: 'time is invalid' };
  const normalized = normalizeApiError(httpError(422, { detail: [detail] }, 'Legacy validation failure'));

  assert.equal(normalized.kind, 'validation');
  assert.equal(normalized.code, undefined);
  assert.equal(normalized.message, 'Legacy validation failure');
  assert.deepEqual(normalized.details, [detail]);
  assert.deepEqual(normalized.fieldIssues, [
    { field: 'unloadTimes', index: 1, label: '卸数时间点' },
  ]);

  const rootArray = [{ field: 'dept_name', message: 'department is invalid' }];
  const legacyArray = normalizeApiError(httpError(422, rootArray));
  assert.deepEqual(legacyArray.details, rootArray);
  assert.deepEqual(legacyArray.fieldIssues, [
    { field: 'dept', index: null, label: '业务部门' },
  ]);
});

test('normalizer retains legacy string details without treating them as structured fields', () => {
  const normalized = normalizeApiError(httpError(422, { detail: 'Legacy validation text' }));

  assert.equal(normalized.message, 'Legacy validation text');
  assert.equal(normalized.details, 'Legacy validation text');
  assert.deepEqual(normalized.fieldIssues, []);
  assert.equal(normalized.safeMessage, '提交内容未通过校验，请检查表单后重试。');

  const rawTextPayload = 'SQL SELECT secret_value FROM private_table';
  const legacyText = normalizeApiError(httpError(500, rawTextPayload, 'HTTP 500'));
  assert.equal(legacyText.message, rawTextPayload);
  assert.equal(legacyText.safeMessage, '服务暂时不可用，请稍后重试。');
  assert.doesNotMatch(legacyText.safeMessage, /SQL|secret_value|private_table/);
});

test('normalizer distinguishes network failures and timeouts', () => {
  const network = normalizeApiError(new TypeError('Failed to fetch'));
  assert.equal(network.kind, 'network');
  assert.equal(network.safeMessage, '网络连接失败，请检查网络后重试。');

  const timeout = normalizeApiError(new Error('接口请求超时（60秒），请稍后重试。'));
  assert.equal(timeout.kind, 'timeout');
  assert.equal(timeout.safeMessage, '请求超时，请稍后重试。');
});

test('unknown codes and missing payloads keep raw metadata but expose only safe fallback text', () => {
  const details = [
    { field: 'private.secret[3].value', index: 3, message: 'secret database row' },
    { field: 'private_unknown_field', message: 'secret field detail' },
  ];
  const rawMessage = 'SQL SELECT secret_value FROM private_table; Traceback ...';
  const normalized = normalizeApiError(httpError(500, {
    error: { code: 'UNRECOGNIZED_INTERNAL_CODE', message: rawMessage, details },
  }));

  assert.equal(normalized.code, 'UNRECOGNIZED_INTERNAL_CODE');
  assert.equal(normalized.message, rawMessage);
  assert.deepEqual(normalized.details, details);
  assert.deepEqual(normalized.fieldIssues, [
    { field: null, index: 3, label: '表单内容' },
    { field: null, index: null, label: '表单内容' },
  ]);
  assert.equal(normalized.safeMessage, '服务暂时不可用，请稍后重试。');
  assert.doesNotMatch(normalized.safeMessage, /SQL|Traceback|secret_value|private_table/);

  const noPayload = normalizeApiError(httpError(500, undefined, rawMessage));
  assert.equal(noPayload.status, 500);
  assert.equal(noPayload.message, rawMessage);
  assert.equal(noPayload.details, undefined);
  assert.equal(noPayload.safeMessage, '服务暂时不可用，请稍后重试。');

  const unknown = normalizeApiError(new Error(rawMessage));
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.message, rawMessage);
  assert.equal(unknown.safeMessage, '操作失败，请稍后重试。');
  assert.doesNotMatch(unknown.safeMessage, /SQL|Traceback|secret_value|private_table/);
});
