import type { TFunction } from 'i18next';

import type {
  ApiAssetParam,
  ApiAssetRelation,
  ApiAssetResponseField,
} from '../data/apiAssets.ts';

export interface ApiAssetFormValues {
  version?: string;
  type?: string;
  maintainerName?: string;
  description?: string;
  remark?: string;
  code: string;
  name: string;
  method: string;
  path: string;
  status: string;
  ownerDept: string;
  ownerName: string;
  downstreamSystemId: string | number | null | undefined;
  params: readonly ApiAssetParam[];
  responseFields: readonly ApiAssetResponseField[];
  relations: readonly ApiAssetRelation[];
}

export interface ApiAssetValidationSystem {
  id: number;
  status: string;
}

export type ApiAssetFieldErrors = Record<string, string>;

export interface ApiAssetSaveFailure {
  summary: string;
  fieldErrors: ApiAssetFieldErrors;
}

const API_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{2,63}$/;
const API_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const PARAM_LOCATIONS = new Set(['query', 'path', 'header', 'body']);
const RELATION_TYPES = new Set(['table', 'indicator', 'system']);
const TEXT_LIMITS = { name: 256, path: 512, version: 64, type: 64, ownerDept: 128, ownerName: 64, maintainerName: 64, description: 2000, remark: 2000 } as const;
type ApiAssetT = TFunction<"apiAsset">;
type ApiAssetMessageValues = Record<string, string | number>;

function message(
  t: ApiAssetT | undefined,
  key: string,
  fallback: string,
  values: ApiAssetMessageValues = {},
): string {
  if (!t) return fallback;
  const translate = t as unknown as (
    translationKey: string,
    options: ApiAssetMessageValues & { defaultValue: string },
  ) => string;
  return translate(key, { ...values, defaultValue: fallback });
}

export function validateApiAssetForm(
  form: ApiAssetFormValues,
  systems: readonly ApiAssetValidationSystem[],
  t?: ApiAssetT,
): ApiAssetFieldErrors {
  const errors: ApiAssetFieldErrors = {};
  const code = form.code.trim().toUpperCase();
  if (!API_CODE_PATTERN.test(code)) {
    errors['code'] = message(t, 'validation.codeInvalid', '请输入有效的 API 编码：首位为字母，其余为大写字母、数字、下划线或连字符，共 3–64 位。');
  }
  if (!form.name.trim()) errors['name'] = message(t, 'validation.nameRequired', '请输入 API 名称。');
  if (!API_METHODS.has(form.method.trim().toUpperCase())) {
    errors['method'] = message(t, 'validation.methodInvalid', '请选择有效的请求方式。');
  }
  if (!form.path.trim().startsWith('/')) errors['path'] = message(t, 'validation.pathPrefix', '请求路径必须以“/”开头。');
  if (!['enabled', 'disabled'].includes(form.status.trim())) {
    errors['status'] = message(t, 'validation.statusInvalid', '请选择有效的 API 状态。');
  }
  if (!form.ownerDept.trim()) errors['ownerDept'] = message(t, 'validation.ownerDeptRequired', '请输入归属部门。');
  if (!form.ownerName.trim()) errors['ownerName'] = message(t, 'validation.ownerNameRequired', '请输入负责人。');
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    const value = form[field as keyof typeof TEXT_LIMITS];
    if (value && Array.from(value.trim()).length > limit) {
      errors[field] = message(t, 'validation.lengthLimit', `${apiAssetFieldLabel(field, t)}不能超过 ${limit} 个字符。`, { field: apiAssetFieldLabel(field, t), limit });
    }
  }

  const systemId = Number(form.downstreamSystemId);
  if (
    !String(form.downstreamSystemId ?? '').trim() ||
    !Number.isInteger(systemId) ||
    !systems.some((system) => system.id === systemId && system.status === 'enabled')
  ) {
    errors['systemId'] = message(t, 'validation.systemInvalid', '请选择有效且已启用的下游调用系统。');
  }

  const paramKeys = new Set<string>();
  form.params.forEach((row, index) => {
    const prefix = `params.${index}`;
    if (!row.name.trim()) errors[`${prefix}.name`] = message(t, 'validation.paramNameRequired', `请输入第 ${index + 1} 行参数名称。`, { row: index + 1 });
    if (!PARAM_LOCATIONS.has(row.in.trim())) {
      errors[`${prefix}.in`] = message(t, 'validation.paramPositionInvalid', `请选择第 ${index + 1} 行参数位置。`, { row: index + 1 });
    }
    if (!row.dataType.trim()) errors[`${prefix}.dataType`] = message(t, 'validation.paramTypeRequired', `请输入第 ${index + 1} 行参数类型。`, { row: index + 1 });
    const key = JSON.stringify([row.name.trim(), row.in.trim()]);
    if (paramKeys.has(key)) errors[prefix] = message(t, 'validation.duplicateParam', `第 ${index + 1} 行参数名称与位置重复。`, { row: index + 1 });
    paramKeys.add(key);
  });

  const responseNames = new Set<string>();
  form.responseFields.forEach((row, index) => {
    const prefix = `responseFields.${index}`;
    if (!row.name.trim()) errors[`${prefix}.name`] = message(t, 'validation.responseNameRequired', `请输入第 ${index + 1} 行响应字段名称。`, { row: index + 1 });
    if (!row.dataType.trim()) errors[`${prefix}.dataType`] = message(t, 'validation.responseTypeRequired', `请输入第 ${index + 1} 行响应字段类型。`, { row: index + 1 });
    if (responseNames.has(row.name.trim())) errors[prefix] = message(t, 'validation.duplicateResponse', `第 ${index + 1} 行响应字段名称重复。`, { row: index + 1 });
    responseNames.add(row.name.trim());
  });

  form.relations.forEach((row, index) => {
    if (!RELATION_TYPES.has(row.type.trim()) || !row.targetCode.trim()) {
      errors[`relations.${index}`] = message(t, 'validation.relationIncomplete', `第 ${index + 1} 项关联资产不完整，请重新选择。`, { row: index + 1 });
    }
  });

  return errors;
}

const API_FIELD_ERRORS: Record<string, { key: string; fallback: string }> = {
  code: { key: 'validation.codeFormatField', fallback: 'API 编码格式不正确，请按规则修正。' },
  name: { key: 'validation.serverNameInvalid', fallback: '请输入 API 名称。' },
  method: { key: 'validation.serverMethodInvalid', fallback: '请选择有效的请求方式。' },
  path: { key: 'validation.serverPathInvalid', fallback: '请求路径必须以“/”开头。' },
  status: { key: 'validation.serverStatusInvalid', fallback: '请选择有效的 API 状态。' },
  ownerDept: { key: 'validation.serverDepartmentInvalid', fallback: '请输入归属部门。' },
  ownerName: { key: 'validation.serverOwnerInvalid', fallback: '请输入负责人。' },
  systemId: { key: 'validation.serverSystemInvalid', fallback: '请选择有效且已启用的下游调用系统。' },
  body: { key: 'validation.serverBodyInvalid', fallback: '提交内容格式不正确，请检查 API 资产表单。' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function rowFieldErrors(
  field: string,
  form: ApiAssetFormValues,
  t?: ApiAssetT,
): ApiAssetFieldErrors | null {
  const match = /^(params|responseFields)\[(\d+)\]$/.exec(field);
  if (match) {
    const kind = match[1] as 'params' | 'responseFields';
    const index = Number(match[2]);
    const row = kind === 'params' ? form.params[index] : form.responseFields[index];
    if (!row) return { [`${kind}.${index}`]: message(t, 'validation.rowMissing', `第 ${index + 1} 行内容已被服务端拒绝，请检查后重试。`, { row: index + 1 }) };

    const errors: ApiAssetFieldErrors = {};
    if (!row.name.trim()) {
      errors[`${kind}.${index}.name`] = message(t, kind === 'params' ? 'validation.paramNameRequired' : 'validation.responseNameRequired', kind === 'params'
        ? `请输入第 ${index + 1} 行参数名称。`
        : `请输入第 ${index + 1} 行响应字段名称。`, { row: index + 1 });
    }
    if (kind === 'params' && !PARAM_LOCATIONS.has((row as ApiAssetParam).in.trim())) {
      errors[`${kind}.${index}.in`] = message(t, 'validation.rowPositionInvalid', `请选择第 ${index + 1} 行参数位置。`, { row: index + 1 });
    }
    if (!row.dataType.trim()) {
      errors[`${kind}.${index}.dataType`] = message(t, kind === 'params' ? 'validation.paramTypeRequired' : 'validation.responseTypeRequired', kind === 'params'
        ? `请输入第 ${index + 1} 行参数类型。`
        : `请输入第 ${index + 1} 行响应字段类型。`, { row: index + 1 });
    }
    return Object.keys(errors).length ? errors : {
      [`${kind}.${index}`]: message(t, 'validation.rowGenericInvalid', `第 ${index + 1} 行内容未通过服务端校验，请检查名称、位置和类型。`, { row: index + 1 }),
    };
  }

  const relationMatch = /^relations\[(\d+)\]$/.exec(field);
  if (!relationMatch) return null;
  const index = Number(relationMatch[1]);
  const relation = form.relations[index];
  if (!relation || !RELATION_TYPES.has(relation.type.trim()) || !relation.targetCode.trim()) {
    return { [`relations.${index}`]: message(t, 'validation.relationSelect', `请选择有效的第 ${index + 1} 项关联资产。`, { row: index + 1 }) };
  }
  return {
    [`relations.${index}`]: message(t, 'validation.relationInvalid', `关联资产第 ${index + 1} 项未通过服务端校验，请重新选择。`, { row: index + 1 }),
  };
}

function validationFieldErrors(
  details: unknown,
  form: ApiAssetFormValues,
  t?: ApiAssetT,
): ApiAssetFieldErrors {
  const fieldErrors: ApiAssetFieldErrors = {};
  if (!Array.isArray(details)) return fieldErrors;

  for (const detail of details) {
    const field = typeof detail === 'string'
      ? ''
      : isRecord(detail) && typeof detail['field'] === 'string'
        ? detail['field'].trim()
        : '';
    if (!field) {
      fieldErrors['form'] = message(t, 'validation.formInvalid', '表单中有字段未通过校验，请检查后重试。');
      continue;
    }
    if (isRecord(detail) && detail['code'] === 'max_length' && Object.hasOwn(TEXT_LIMITS, field)) {
      fieldErrors[field] = message(t, 'validation.lengthLimit', `${apiAssetFieldLabel(field, t)}不能超过 ${TEXT_LIMITS[field as keyof typeof TEXT_LIMITS]} 个字符。`, { field: apiAssetFieldLabel(field, t), limit: TEXT_LIMITS[field as keyof typeof TEXT_LIMITS] });
      continue;
    }
    const rowErrors = rowFieldErrors(field, form, t);
    if (rowErrors) {
      Object.assign(fieldErrors, rowErrors);
      continue;
    }
    const mappedError = API_FIELD_ERRORS[field];
    if (mappedError) {
      fieldErrors[field] = message(t, mappedError.key, mappedError.fallback);
    } else {
      fieldErrors['form'] = message(t, 'validation.formInvalid', '表单中有字段未通过校验，请检查后重试。');
    }
  }
  return fieldErrors;
}

export function normalizeApiAssetSaveFailure(
  error: unknown,
  form: ApiAssetFormValues,
  t?: ApiAssetT,
): ApiAssetSaveFailure {
  const errorRecord = isRecord(error) ? error : {};
  const status = typeof errorRecord['status'] === 'number' ? errorRecord['status'] : undefined;
  const payload = isRecord(errorRecord['payload']) ? errorRecord['payload'] : {};
  const envelope = isRecord(payload['error']) ? payload['error'] : {};
  const code = typeof envelope['code'] === 'string' ? envelope['code'] : '';
  const details = envelope['details'];

  if (status === 401) {
    return { summary: message(t, 'errors.sessionExpired', '登录状态已失效，请重新登录后再保存。'), fieldErrors: {} };
  }
  if (status === 403) {
    return { summary: message(t, 'errors.forbidden', '当前账号没有新增或编辑 API 资产的权限。'), fieldErrors: {} };
  }
  if (status === 409 && code === 'API_ASSET_ALREADY_EXISTS') {
    return {
      summary: message(t, 'errors.alreadyExistsSummary', 'API 编码已存在，请修改编码后重试。'),
      fieldErrors: { code: message(t, 'errors.alreadyExistsField', '该 API 编码已存在，请使用其他编码。') },
    };
  }
  if (status === 422 && code === 'API_ASSET_VALIDATION_FAILED') {
    const fieldErrors = validationFieldErrors(details, form, t);
    return {
      summary: Object.keys(fieldErrors).length
        ? message(t, 'errors.validationDetails', 'API 资产校验未通过，请根据下方字段提示修正后重试。')
        : message(t, 'errors.validationGeneric', 'API 资产校验未通过，请检查表单后重试。'),
      fieldErrors,
    };
  }
  if (status === 409) {
    return { summary: message(t, 'errors.conflict', 'API 资产存在数据冲突，请检查编码或当前数据后重试。'), fieldErrors: {} };
  }
  if (status !== undefined && status >= 500) {
    return { summary: message(t, 'errors.server', '服务暂时不可用，API 资产未能保存，请稍后重试。'), fieldErrors: {} };
  }
  if (status === 404) {
    return { summary: message(t, 'errors.notFound', 'API 资产或关联业务系统不存在，请刷新后重试。'), fieldErrors: {} };
  }
  if (status === 422 || code === 'VALIDATION_ERROR') {
    return { summary: message(t, 'errors.invalidPayload', '提交内容格式不符合接口要求，请检查 API 资产表单后重试。'), fieldErrors: {} };
  }
  if (status !== undefined) {
    return { summary: message(t, 'errors.httpStatus', `API 资产保存失败（HTTP ${status}），请检查输入后重试。`, { status }), fieldErrors: {} };
  }

  if (error instanceof Error && /^接口请求超时/.test(error.message)) {
    return { summary: error.message, fieldErrors: {} };
  }
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network error/i.test(error.message))) {
    return { summary: message(t, 'errors.network', '网络连接失败，API 资产未能保存，请检查网络后重试。'), fieldErrors: {} };
  }
  if (error instanceof Error && error.message === 'API 编码已存在') {
    return {
      summary: message(t, 'errors.alreadyExistsSummary', 'API 编码已存在，请修改编码后重试。'),
      fieldErrors: { code: message(t, 'errors.alreadyExistsField', '该 API 编码已存在，请使用其他编码。') },
    };
  }
  return { summary: message(t, 'errors.fallback', 'API 资产保存失败，请检查网络连接后重试。'), fieldErrors: {} };
}

export function apiAssetFieldLabel(field: string, t?: ApiAssetT): string {
  const labels: Record<string, { key: string; fallback: string }> = {
    code: { key: 'fields.code', fallback: 'API 编码' },
    name: { key: 'fields.name', fallback: 'API 名称' },
    method: { key: 'fields.method', fallback: '请求方式' },
    path: { key: 'fields.path', fallback: '请求路径' },
    status: { key: 'fields.status', fallback: '状态' },
    ownerDept: { key: 'fields.ownerDept', fallback: '归属部门' },
    ownerName: { key: 'fields.ownerName', fallback: '负责人' },
    version: { key: 'fields.version', fallback: '版本' },
    type: { key: 'fields.type', fallback: 'API 类型' },
    maintainerName: { key: 'fields.maintainerName', fallback: '维护人' },
    description: { key: 'fields.description', fallback: '说明' },
    remark: { key: 'fields.remark', fallback: '备注' },
    systemId: { key: 'fields.systemId', fallback: '下游调用系统' },
    body: { key: 'fields.body', fallback: '表单' },
    form: { key: 'fields.form', fallback: '表单' },
    relations: { key: 'fields.relations', fallback: '关联资产' },
  };
  const label = labels[field];
  if (label) return message(t, label.key, label.fallback);
  const row = /^(params|responseFields)\.(\d+)(?:\.(name|in|dataType))?$/.exec(field);
  if (row) {
    const kindIsParams = row[1] === 'params';
    const rowLabel = kindIsParams ? '请求参数' : '响应字段';
    const columnKey = row[3] === 'name' ? 'rows.name' : row[3] === 'in' ? 'rows.location' : row[3] === 'dataType' ? 'rows.type' : '';
    const column = columnKey ? message(t, columnKey, row[3] === 'name' ? '名称' : row[3] === 'in' ? '位置' : '类型') : '';
    const rowNumber = Number(row[2]) + 1;
    return t
      ? message(t, 'validation.rowFieldLabel', `${rowLabel}第 ${rowNumber} 行${column ? ` ${column}` : ''}`, {
          kind: message(t, kindIsParams ? 'validation.paramKind' : 'validation.responseKind', rowLabel),
          row: rowNumber,
          column,
        })
      : `${rowLabel}第 ${rowNumber} 行${column ? ` ${column}` : ''}`;
  }
  const relation = /^relations\.(\d+)$/.exec(field);
  if (relation) {
    const row = Number(relation[1]) + 1;
    return message(t, 'validation.relationFieldLabel', `关联资产第 ${row} 项`, { row });
  }
  return field;
}
