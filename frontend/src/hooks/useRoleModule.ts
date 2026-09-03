// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from 'react';
import {
  createRole,
  deleteRole,
  getRoleAssignablePermissions,
  getRoles,
  updateRole,
  type SystemPermissionItem,
  type SystemRoleItem,
} from '../api/systemRoles.ts';
import { toast } from '../components/common/index.ts';
import { getErrorMessage, type ErrorWithPayload } from '../utils/ui.ts';
import { normalizeRolePermissionCodes } from '../auth/permissions.ts';

export interface RoleFormData {
  roleCode: string;
  name: string;
  description: string;
  enabled: string;
  permissionCodes: readonly string[];
}

const DEFAULT_FORM: RoleFormData = {
  roleCode: '',
  name: '',
  description: '',
  enabled: 'enabled',
  permissionCodes: [],
};

export interface RoleFormFieldError {
  field: string;
  message: string;
}

function getFieldErrors(error: unknown, fallback: string): RoleFormFieldError[] {
  const errWithPayload = error as ErrorWithPayload | undefined;
  const details = errWithPayload?.payload?.error?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((item) => {
      if (typeof item === 'string') return { field: 'form', message: item };
      return { field: item.field || 'form', message: item.message || '' };
    });
  }
  return [{ field: 'form', message: getErrorMessage(error, fallback) }];
}

export interface RoleModalState {
  open: boolean;
  mode: 'new' | 'edit';
  initial: SystemRoleItem | null;
  busy: boolean;
}

export interface UseRoleModuleProps {
  active?: boolean | undefined;
  requireLogin: (action: () => void, permission?: string) => boolean;
  actionIntent?: string | undefined;
  onActionHandled?: (() => void) | undefined;
}

export interface UseRoleModuleResult {
  loading: boolean;
  error: string;
  roles: SystemRoleItem[];
  permissions: SystemPermissionItem[];
  modal: RoleModalState;
  setModal: React.Dispatch<React.SetStateAction<RoleModalState>>;
  form: RoleFormData;
  setForm: React.Dispatch<React.SetStateAction<RoleFormData>>;
  errors: RoleFormFieldError[];
  deletingRoleCode: string;
  load: () => Promise<void>;
  openNew: () => void;
  openEdit: (role: SystemRoleItem) => void;
  submit: () => Promise<void>;
  remove: (role?: SystemRoleItem | null) => Promise<void>;
}

export function useRoleModule({
  active,
  requireLogin,
  actionIntent,
  onActionHandled,
}: UseRoleModuleProps): UseRoleModuleResult {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [roles, setRoles] = React.useState<SystemRoleItem[]>([]);
  const [permissions, setPermissions] = React.useState<SystemPermissionItem[]>([]);
  const [modal, setModal] = React.useState<RoleModalState>({
    open: false,
    mode: 'new',
    initial: null,
    busy: false,
  });
  const [form, setForm] = React.useState<RoleFormData>(DEFAULT_FORM);
  const [errors, setErrors] = React.useState<RoleFormFieldError[]>([]);
  const [deletingRoleCode, setDeletingRoleCode] = React.useState('');
  const requestSeq = React.useRef(0);
  const deletingRoleCodes = React.useRef(new Set<string>());

  const load = React.useCallback(async (): Promise<void> => {
    const requestId = ++requestSeq.current;
    setLoading(true);
    setError('');
    try {
      const [nextRoles, nextPermissions] = await Promise.all([
        getRoles(),
        getRoleAssignablePermissions(),
      ]);
      if (requestId !== requestSeq.current) return;
      setRoles(nextRoles);
      setPermissions(nextPermissions);
    } catch (nextError: unknown) {
      if (requestId === requestSeq.current) setError(getErrorMessage(nextError, '加载角色权限数据失败。'));
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!active) return undefined;
    load();
    return () => {
      requestSeq.current += 1;
    };
  }, [active, load]);

  const openNew = React.useCallback((): void => {
    requireLogin(() => {
      setErrors([]);
      setForm(DEFAULT_FORM);
      setModal({ open: true, mode: 'new', initial: null, busy: false });
    }, 'system:role:write');
  }, [requireLogin]);

  const openEdit = React.useCallback(
    (role: SystemRoleItem): void => {
      requireLogin(() => {
        setErrors([]);
        setForm({
          roleCode: role.roleCode || '',
          name: role.name || '',
          description: role.description || '',
          enabled: role.enabled || 'enabled',
          permissionCodes: normalizeRolePermissionCodes(role.permissionCodes),
        });
        setModal({ open: true, mode: 'edit', initial: role, busy: false });
      }, 'system:role:write');
    },
    [requireLogin],
  );

  React.useEffect(() => {
    if (actionIntent !== 'new-role') return undefined;
    openNew();
    onActionHandled?.();
    return undefined;
  }, [actionIntent, onActionHandled, openNew]);

  const validate = React.useCallback((): boolean => {
    const nextErrors: RoleFormFieldError[] = [];
    if (!form.roleCode.trim()) nextErrors.push({ field: 'roleCode', message: '角色编码不能为空' });
    else if (!/^[a-z][a-z0-9_-]{0,63}$/.test(form.roleCode.trim())) {
      nextErrors.push({ field: 'roleCode', message: '角色编码格式不正确' });
    }
    if (!form.name.trim()) nextErrors.push({ field: 'name', message: '角色名称不能为空' });
    setErrors(nextErrors);
    return !nextErrors.length;
  }, [form]);

  const submit = React.useCallback(async (): Promise<void> => {
    if (!validate()) return;
    setModal((previous) => ({ ...previous, busy: true }));
    try {
      const payload = {
        roleCode: form.roleCode.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        enabled: form.enabled,
        permissionCodes: normalizeRolePermissionCodes(form.permissionCodes),
      };
      if (modal.mode === 'edit' && modal.initial) {
        await updateRole(modal.initial.roleCode, payload);
      } else {
        await createRole(payload);
      }
      await load();
      setModal({ open: false, mode: 'new', initial: null, busy: false });
      setForm(DEFAULT_FORM);
    } catch (nextError: unknown) {
      setErrors(getFieldErrors(nextError, '保存角色失败。'));
      setModal((previous) => ({ ...previous, busy: false }));
    }
  }, [form, load, modal, validate]);

  const remove = React.useCallback(
    async (role?: SystemRoleItem | null): Promise<void> => {
      const code = String(role?.roleCode || '').trim().toLowerCase();
      if (!code || deletingRoleCodes.current.has(code)) return;
      deletingRoleCodes.current.add(code);
      setDeletingRoleCode(code);
      setModal((previous) => ({ ...previous, busy: true }));
      try {
        await deleteRole(code);
        setRoles((current) => current.filter((item) => item.roleCode !== code));
        await load();
        setModal({ open: false, mode: 'new', initial: null, busy: false });
        setForm(DEFAULT_FORM);
        toast.success(`角色「${role?.name || code}」已删除`);
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '删除角色失败。'));
        setModal((previous) => ({ ...previous, busy: false }));
        throw nextError;
      } finally {
        deletingRoleCodes.current.delete(code);
        setDeletingRoleCode((current) => (current === code ? '' : current));
      }
    },
    [load],
  );

  return {
    loading,
    error,
    roles,
    permissions,
    modal,
    setModal,
    form,
    setForm,
    errors,
    deletingRoleCode,
    load,
    openNew,
    openEdit,
    submit,
    remove,
  };
}
