import type {
  ApiAssetParam,
  ApiAssetRelation,
  ApiAssetResponseField,
} from '../data/apiAssets.ts';

export interface ApiAssetFormValues {
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

export function validateApiAssetForm(
  form: ApiAssetFormValues,
  systems: readonly ApiAssetValidationSystem[],
): ApiAssetFieldErrors {
  const errors: ApiAssetFieldErrors = {};
  const code = form.code.trim().toUpperCase();
  if (!API_CODE_PATTERN.test(code)) {
    errors['code'] = '请输入有效的 API 编码：首位为字母，其余为大写字母、数字、下划线或连字符，共 3–64 位。';
  }
  if (!form.name.trim()) errors['name'] = '请输入 API 名称。';
  if (!API_METHODS.has(form.method.trim().toUpperCase())) {
    errors['method'] = '请选择有效的请求方式。';
  }
  if (!form.path.trim().startsWith('/')) errors['path'] = '请求路径必须以“/”开头。';
  if (!['enabled', 'disabled'].includes(form.status.trim())) {
    errors['status'] = '请选择有效的 API 状态。';
  }
  if (!form.ownerDept.trim()) errors['ownerDept'] = '请输入归属部门。';
  if (!form.ownerName.trim()) errors['ownerName'] = '请输入负责人。';

  const systemId = Number(form.downstreamSystemId);
  if (
    !String(form.downstreamSystemId ?? '').trim() ||
    !Number.isInteger(systemId) ||
    !systems.some((system) => system.id === systemId && system.status === 'enabled')
  ) {
    errors['systemId'] = '请选择有效且已启用的下游调用系统。';
  }

  form.params.forEach((row, index) => {
    const prefix = `params.${index}`;
    if (!row.name.trim()) errors[`${prefix}.name`] = `请输入第 ${index + 1} 行参数名称。`;
    if (!PARAM_LOCATIONS.has(row.in.trim())) {
      errors[`${prefix}.in`] = `请选择第 ${index + 1} 行参数位置。`;
    }
    if (!row.dataType.trim()) errors[`${prefix}.dataType`] = `请输入第 ${index + 1} 行参数类型。`;
  });

  form.responseFields.forEach((row, index) => {
    const prefix = `responseFields.${index}`;
    if (!row.name.trim()) errors[`${prefix}.name`] = `请输入第 ${index + 1} 行响应字段名称。`;
    if (!row.dataType.trim()) errors[`${prefix}.dataType`] = `请输入第 ${index + 1} 行响应字段类型。`;
  });

  form.relations.forEach((row, index) => {
    if (!RELATION_TYPES.has(row.type.trim()) || !row.targetCode.trim()) {
      errors[`relations.${index}`] = `第 ${index + 1} 项关联资产不完整，请重新选择。`;
    }
  });

  return errors;
}

const API_FIELD_ERRORS: Record<string, string> = {
  code: 'API 编码格式不正确，请按规则修正。',
  name: '请输入 API 名称。',
  method: '请选择有效的请求方式。',
  path: '请求路径必须以“/”开头。',
  status: '请选择有效的 API 状态。',
  ownerDept: '请输入归属部门。',
  ownerName: '请输入负责人。',
  systemId: '请选择有效且已启用的下游调用系统。',
  body: '提交内容格式不正确，请检查 API 资产表单。',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function rowFieldErrors(
  field: string,
  form: ApiAssetFormValues,
): ApiAssetFieldErrors | null {
  const match = /^(params|responseFields)\[(\d+)\]$/.exec(field);
  if (match) {
    const kind = match[1] as 'params' | 'responseFields';
    const index = Number(match[2]);
    const row = kind === 'params' ? form.params[index] : form.responseFields[index];
    if (!row) return { [`${kind}.${index}`]: `第 ${index + 1} 行内容已被服务端拒绝，请检查后重试。` };

    const errors: ApiAssetFieldErrors = {};
    if (!row.name.trim()) {
      errors[`${kind}.${index}.name`] = kind === 'params'
        ? `请输入第 ${index + 1} 行参数名称。`
        : `请输入第 ${index + 1} 行响应字段名称。`;
    }
    if (kind === 'params' && !PARAM_LOCATIONS.has((row as ApiAssetParam).in.trim())) {
      errors[`${kind}.${index}.in`] = `请选择第 ${index + 1} 行参数位置。`;
    }
    if (!row.dataType.trim()) {
      errors[`${kind}.${index}.dataType`] = kind === 'params'
        ? `请输入第 ${index + 1} 行参数类型。`
        : `请输入第 ${index + 1} 行响应字段类型。`;
    }
    return Object.keys(errors).length ? errors : {
      [`${kind}.${index}`]: `第 ${index + 1} 行内容未通过服务端校验，请检查名称、位置和类型。`,
    };
  }

  const relationMatch = /^relations\[(\d+)\]$/.exec(field);
  if (!relationMatch) return null;
  const index = Number(relationMatch[1]);
  const relation = form.relations[index];
  if (!relation || !RELATION_TYPES.has(relation.type.trim()) || !relation.targetCode.trim()) {
    return { [`relations.${index}`]: `请选择有效的第 ${index + 1} 项关联资产。` };
  }
  return {
    [`relations.${index}`]: `关联资产第 ${index + 1} 项未通过服务端校验，请重新选择。`,
  };
}

function validationFieldErrors(
  details: unknown,
  form: ApiAssetFormValues,
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
      fieldErrors['form'] = '表单中有字段未通过校验，请检查后重试。';
      continue;
    }
    const rowErrors = rowFieldErrors(field, form);
    if (rowErrors) {
      Object.assign(fieldErrors, rowErrors);
      continue;
    }
    const mappedError = API_FIELD_ERRORS[field];
    if (Object.prototype.hasOwnProperty.call(API_FIELD_ERRORS, field) && mappedError !== undefined) {
      fieldErrors[field] = mappedError;
    } else {
      fieldErrors['form'] = '表单中有字段未通过校验，请检查后重试。';
    }
  }
  return fieldErrors;
}

export function normalizeApiAssetSaveFailure(
  error: unknown,
  form: ApiAssetFormValues,
): ApiAssetSaveFailure {
  const errorRecord = isRecord(error) ? error : {};
  const status = typeof errorRecord['status'] === 'number' ? errorRecord['status'] : undefined;
  const payload = isRecord(errorRecord['payload']) ? errorRecord['payload'] : {};
  const envelope = isRecord(payload['error']) ? payload['error'] : {};
  const code = typeof envelope['code'] === 'string' ? envelope['code'] : '';
  const details = envelope['details'];

  if (status === 401) {
    return { summary: '登录状态已失效，请重新登录后再保存。', fieldErrors: {} };
  }
  if (status === 403) {
    return { summary: '当前账号没有新增或编辑 API 资产的权限。', fieldErrors: {} };
  }
  if (status === 409 && code === 'API_ASSET_ALREADY_EXISTS') {
    return {
      summary: 'API 编码已存在，请修改编码后重试。',
      fieldErrors: { code: '该 API 编码已存在，请使用其他编码。' },
    };
  }
  if (status === 422 && code === 'API_ASSET_VALIDATION_FAILED') {
    const fieldErrors = validationFieldErrors(details, form);
    return {
      summary: Object.keys(fieldErrors).length
        ? 'API 资产校验未通过，请根据下方字段提示修正后重试。'
        : 'API 资产校验未通过，请检查表单后重试。',
      fieldErrors,
    };
  }
  if (status === 409) {
    return { summary: 'API 资产存在数据冲突，请检查编码或当前数据后重试。', fieldErrors: {} };
  }
  if (status !== undefined && status >= 500) {
    return { summary: '服务暂时不可用，API 资产未能保存，请稍后重试。', fieldErrors: {} };
  }
  if (status === 404) {
    return { summary: 'API 资产或关联业务系统不存在，请刷新后重试。', fieldErrors: {} };
  }
  if (status === 422 || code === 'VALIDATION_ERROR') {
    return { summary: '提交内容格式不符合接口要求，请检查 API 资产表单后重试。', fieldErrors: {} };
  }
  if (status !== undefined) {
    return { summary: `API 资产保存失败（HTTP ${status}），请检查输入后重试。`, fieldErrors: {} };
  }

  if (error instanceof Error && /^接口请求超时/.test(error.message)) {
    return { summary: error.message, fieldErrors: {} };
  }
  if (error instanceof TypeError || (error instanceof Error && /failed to fetch|network error/i.test(error.message))) {
    return { summary: '网络连接失败，API 资产未能保存，请检查网络后重试。', fieldErrors: {} };
  }
  if (error instanceof Error && error.message === 'API 编码已存在') {
    return {
      summary: 'API 编码已存在，请修改编码后重试。',
      fieldErrors: { code: '该 API 编码已存在，请使用其他编码。' },
    };
  }
  return { summary: 'API 资产保存失败，请检查网络连接后重试。', fieldErrors: {} };
}

export function apiAssetFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    code: 'API 编码',
    name: 'API 名称',
    method: '请求方式',
    path: '请求路径',
    status: '状态',
    ownerDept: '归属部门',
    ownerName: '负责人',
    systemId: '下游调用系统',
    body: '表单',
    form: '表单',
  };
  const label = labels[field];
  if (label) return label;
  const row = /^(params|responseFields)\.(\d+)(?:\.(name|in|dataType))?$/.exec(field);
  if (row) {
    const rowLabel = row[1] === 'params' ? '请求参数' : '响应字段';
    const column = row[3] === 'name' ? '名称' : row[3] === 'in' ? '位置' : row[3] === 'dataType' ? '类型' : '';
    return `${rowLabel}第 ${Number(row[2]) + 1} 行${column ? ` ${column}` : ''}`;
  }
  const relation = /^relations\.(\d+)$/.exec(field);
  if (relation) return `关联资产第 ${Number(relation[1]) + 1} 项`;
  return field;
}
