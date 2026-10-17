import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiAssetFormValues } from './apiAssetValidation.ts';
import {
  apiAssetFieldLabel,
  normalizeApiAssetSaveFailure,
  validateApiAssetForm,
} from './apiAssetValidation.ts';

const validForm: ApiAssetFormValues = {
  code: 'ORDER_QUERY',
  name: '订单查询',
  method: 'GET',
  path: '/orders',
  status: 'enabled',
  ownerDept: '数据平台',
  ownerName: '维护人',
  downstreamSystemId: '3',
  params: [{ name: 'orderId', in: 'query', dataType: 'string', required: true, description: '', example: '' }],
  responseFields: [{ name: 'orderId', dataType: 'string', description: '', example: '' }],
  relations: [{ type: 'table', targetCode: 'DWD_ORDER', targetName: '订单明细' }],
};
const enabledSystems = [{ id: 3, status: 'enabled' }];

test('storage lengths are validated locally and structured server limits use safe field labels', () => {
  assert.deepEqual(validateApiAssetForm({ ...validForm, name: 'x'.repeat(256) }, enabledSystems), {});
  assert.match(validateApiAssetForm({ ...validForm, name: 'x'.repeat(257) }, enabledSystems)['name']!, /256/);
  const failure = normalizeApiAssetSaveFailure(httpError(422, 'API_ASSET_VALIDATION_FAILED', [
    { field: 'version', code: 'max_length', maxLength: 64, message: 'private server text' },
  ]), validForm);
  assert.equal(failure.fieldErrors['version'], '版本不能超过 64 个字符。');
});

test('duplicate parameter identities and response names locate the second row', () => {
  const errors = validateApiAssetForm({
    ...validForm,
    params: [validForm.params[0]!, { ...validForm.params[0]!, name: ' orderId ' }],
    responseFields: [validForm.responseFields[0]!, validForm.responseFields[0]!],
  }, enabledSystems);
  assert.deepEqual(Object.keys(errors), ['params.1', 'responseFields.1']);
});

function httpError(status: number, code: string, details?: unknown): Error & { status: number; payload: unknown } {
  return Object.assign(new Error('English server message'), {
    status,
    payload: { error: { code, message: 'English server message', details } },
  });
}

test('client validation mirrors API asset required-field and row contracts', () => {
  const errors = validateApiAssetForm(
    {
      ...validForm,
      code: 'bad code',
      name: ' ',
      path: 'orders',
      ownerDept: '',
      ownerName: '',
      downstreamSystemId: '8',
      params: [{ name: '', in: 'query', dataType: '', required: true, description: '', example: '' }],
      responseFields: [{ name: '', dataType: 'string', description: '', example: '' }],
      relations: [{ type: 'table', targetCode: '', targetName: '' }],
    },
    enabledSystems,
  );

  assert.deepEqual(Object.keys(errors), [
    'code', 'name', 'path', 'ownerDept', 'ownerName', 'systemId',
    'params.0.name', 'params.0.dataType', 'responseFields.0.name', 'relations.0',
  ]);
  assert.match(errors['code'] ?? '', /API 编码/);
  assert.match(errors['systemId'] ?? '', /已启用/);
  assert.match(errors['params.0.name'] ?? '', /第 1 行/);
});

test('valid create form has no client-side validation errors', () => {
  assert.deepEqual(validateApiAssetForm(validForm, enabledSystems), {});
});

test('API validation details map to Chinese fields and preserve array row indices', () => {
  const failure = normalizeApiAssetSaveFailure(
    httpError(422, 'API_ASSET_VALIDATION_FAILED', [
      { field: 'name', message: 'name is required' },
      { field: 'systemId', message: 'business system is invalid' },
      { field: 'params[0]', message: 'required fields are invalid' },
      { field: 'responseFields[0]', message: 'required fields are invalid' },
      { field: 'relations[0]', message: 'target asset is invalid' },
      { field: 'internalField', message: 'internal implementation detail' },
    ]),
    {
      ...validForm,
      name: '',
      params: [{ name: '', in: 'query', dataType: 'string', required: true, description: '', example: '' }],
      responseFields: [{ name: 'orderId', dataType: '', description: '', example: '' }],
    },
  );

  assert.equal(failure.summary, 'API 资产校验未通过，请根据下方字段提示修正后重试。');
  assert.equal(failure.fieldErrors['name'], '请输入 API 名称。');
  assert.equal(failure.fieldErrors['systemId'], '请选择有效且已启用的下游调用系统。');
  assert.equal(failure.fieldErrors['params.0.name'], '请输入第 1 行参数名称。');
  assert.equal(failure.fieldErrors['responseFields.0.dataType'], '请输入第 1 行响应字段类型。');
  assert.equal(failure.fieldErrors['relations.0'], '关联资产第 1 项未通过服务端校验，请重新选择。');
  assert.equal(failure.fieldErrors['form'], '表单中有字段未通过校验，请检查后重试。');
  assert.doesNotMatch(JSON.stringify(failure), /English server message|name is required|internal implementation detail/);
  assert.equal(apiAssetFieldLabel('params.0.name'), '请求参数第 1 行 名称');
  assert.equal(apiAssetFieldLabel('relations.0'), '关联资产第 1 项');
});

test('duplicate code 409 is attached to API code, not treated as field validation', () => {
  const failure = normalizeApiAssetSaveFailure(
    httpError(409, 'API_ASSET_ALREADY_EXISTS'),
    validForm,
  );
  assert.equal(failure.fieldErrors['code'], '该 API 编码已存在，请使用其他编码。');
  assert.equal(Object.keys(failure.fieldErrors).length, 1);
});

test('auth, permission, server, and network failures are safe and distinct from 422 field errors', () => {
  const cases: Array<[unknown, string]> = [
    [httpError(401, 'UNAUTHORIZED'), '登录状态已失效，请重新登录后再保存。'],
    [httpError(403, 'FORBIDDEN'), '当前账号没有新增或编辑 API 资产的权限。'],
    [httpError(500, 'INTERNAL_SERVER_ERROR'), '服务暂时不可用，API 资产未能保存，请稍后重试。'],
    [new TypeError('Failed to fetch'), '网络连接失败，API 资产未能保存，请检查网络后重试。'],
    [httpError(422, 'VALIDATION_ERROR', [{ field: 'body', message: 'invalid body' }]), '提交内容格式不符合接口要求，请检查 API 资产表单后重试。'],
  ];

  for (const [error, expected] of cases) {
    const failure = normalizeApiAssetSaveFailure(error, validForm);
    assert.equal(failure.summary, expected);
    assert.deepEqual(failure.fieldErrors, {});
    assert.doesNotMatch(failure.summary, /SQL|stack|English server message|invalid body/i);
  }
});
