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
  createParamDict,
  deleteParamDict,
  getParamDictCategories,
  getParamDicts,
  updateParamDict,
  updateParamDictStatus,
  type ParamDictCategoryWithCount,
  type ParamDictItemWithCategoryName,
} from '../api/paramDicts.ts';
import {
  createUser,
  deleteUser,
  getUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from '../api/systemUsers.ts';
import type { MockSystemUser } from '../data/systemUsers.ts';
import {
  createMenu,
  deleteMenu,
  getMenus,
  moveMenu,
  updateMenu,
  updateMenuStatus,
  type MenuPayload,
} from '../api/menus.ts';
import type { MenuItem } from '../data/menus.ts';
import { getErrorMessage, type ErrorWithPayload } from '../utils/ui.ts';
import { toast } from '../components/common/index.ts';
import { DEFAULT_MENU_FORM, DEFAULT_PARAM_FORM, DEFAULT_USER_FORM } from '../components/system/constants.js';

export interface UserFormData {
  username: string;
  displayName: string;
  status: string;
  role: string;
  email: string;
  remark: string;
}

export interface ParamFormData {
  categoryCode: string;
  code: string;
  name: string;
  value: string;
  status: string;
  desc: string;
}

export interface MenuFormData {
  code: string;
  name: string;
  icon: string;
  path: string;
  order: string | number;
  navPlacement: string;
  adminOnly: boolean;
  status: string;
  desc: string;
}

export interface SystemFormFieldError {
  field: string;
  message: string;
}

function getFieldErrors(error: unknown, fallback: string): SystemFormFieldError[] {
  const errWithPayload = error as ErrorWithPayload | undefined;
  const details = errWithPayload?.payload?.error?.details;
  if (Array.isArray(details) && details.length) {
    return details.map((item) =>
      typeof item === 'string' ? { field: 'form', message: item } : { field: item.field || 'form', message: item.message || '' },
    );
  }
  return [{ field: 'form', message: getErrorMessage(error, fallback) }];
}

export interface SystemModalState<T> {
  open: boolean;
  mode: 'new' | 'edit';
  initial: T | null;
  busy: boolean;
}

export interface UseSystemModuleProps {
  page?: string | undefined;
  requireLogin: (action: () => void, permission?: string) => boolean;
  actionIntent?: string | undefined;
  onActionHandled?: (() => void) | undefined;
}

export interface UseSystemModuleResult {
  loading: boolean;
  error: string;
  users: MockSystemUser[];
  categories: ParamDictCategoryWithCount[];
  items: ParamDictItemWithCategoryName[];
  menus: MenuItem[];
  selectedCategoryCode: string;
  setSelectedCategoryCode: React.Dispatch<React.SetStateAction<string>>;
  userModal: SystemModalState<MockSystemUser>;
  setUserModal: React.Dispatch<React.SetStateAction<SystemModalState<MockSystemUser>>>;
  paramModal: SystemModalState<ParamDictItemWithCategoryName>;
  setParamModal: React.Dispatch<React.SetStateAction<SystemModalState<ParamDictItemWithCategoryName>>>;
  menuModal: SystemModalState<MenuItem>;
  setMenuModal: React.Dispatch<React.SetStateAction<SystemModalState<MenuItem>>>;
  userForm: UserFormData;
  setUserForm: React.Dispatch<React.SetStateAction<UserFormData>>;
  paramForm: ParamFormData;
  setParamForm: React.Dispatch<React.SetStateAction<ParamFormData>>;
  menuForm: MenuFormData;
  setMenuForm: React.Dispatch<React.SetStateAction<MenuFormData>>;
  userErrors: SystemFormFieldError[];
  paramErrors: SystemFormFieldError[];
  menuErrors: SystemFormFieldError[];
  loadAll: () => Promise<void>;
  openNewUser: () => void;
  openEditUser: (user: MockSystemUser) => void;
  openNewParam: () => void;
  openEditParam: (item: ParamDictItemWithCategoryName) => void;
  openNewMenu: () => void;
  openEditMenu: (menu: MenuItem) => void;
  handleSubmitUser: () => Promise<void>;
  handleSubmitParam: () => Promise<void>;
  handleSubmitMenu: () => Promise<void>;
  handleResetPassword: (user: MockSystemUser) => void;
  handleChangeUserStatus: (user: MockSystemUser, status: string) => void;
  handleChangeParamStatus: (item: ParamDictItemWithCategoryName, status: string) => void;
  handleChangeMenuStatus: (menu: MenuItem, status: string) => void;
  handleMoveMenu: (menu: MenuItem, direction: 'up' | 'down') => void;
  handleDeleteUser: (user: MockSystemUser) => void;
  handleDeleteParam: (item: ParamDictItemWithCategoryName) => void;
  handleDeleteMenu: (menu: MenuItem) => void;
}

export function useSystemModule({
  page,
  requireLogin,
  actionIntent,
  onActionHandled,
}: UseSystemModuleProps): UseSystemModuleResult {
  const currentPage = ['menus', 'param-dicts', 'roles'].includes(page || '') ? page : 'users';
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [users, setUsers] = React.useState<MockSystemUser[]>([]);
  const [categories, setCategories] = React.useState<ParamDictCategoryWithCount[]>([]);
  const [items, setItems] = React.useState<ParamDictItemWithCategoryName[]>([]);
  const [menus, setMenus] = React.useState<MenuItem[]>([]);
  const [selectedCategoryCode, setSelectedCategoryCode] = React.useState('');

  const [userModal, setUserModal] = React.useState<SystemModalState<MockSystemUser>>({
    open: false,
    mode: 'new',
    initial: null,
    busy: false,
  });
  const [paramModal, setParamModal] = React.useState<SystemModalState<ParamDictItemWithCategoryName>>({
    open: false,
    mode: 'new',
    initial: null,
    busy: false,
  });
  const [menuModal, setMenuModal] = React.useState<SystemModalState<MenuItem>>({
    open: false,
    mode: 'new',
    initial: null,
    busy: false,
  });
  const [userForm, setUserForm] = React.useState<UserFormData>(DEFAULT_USER_FORM);
  const [paramForm, setParamForm] = React.useState<ParamFormData>(DEFAULT_PARAM_FORM);
  const [menuForm, setMenuForm] = React.useState<MenuFormData>(DEFAULT_MENU_FORM);
  const [userErrors, setUserErrors] = React.useState<SystemFormFieldError[]>([]);
  const [paramErrors, setParamErrors] = React.useState<SystemFormFieldError[]>([]);
  const [menuErrors, setMenuErrors] = React.useState<SystemFormFieldError[]>([]);
  const itemsRequestSeq = React.useRef(0);
  const loadedItemsCategoryRef = React.useRef('');
  const pageRequestSeq = React.useRef(0);
  const loadedPagesRef = React.useRef(new Set<string>());

  const guarded = React.useCallback(
    (action: () => void | Promise<void>) => {
      requireLogin(() => {
        void action();
      });
    },
    [requireLogin],
  );

  const loadUsers = React.useCallback(async (): Promise<void> => {
    setUsers(await getUsers());
  }, []);

  const loadMenus = React.useCallback(async (): Promise<void> => {
    setMenus(await getMenus());
  }, []);

  const loadCategories = React.useCallback(async (): Promise<void> => {
    const nextCategories = await getParamDictCategories();
    setCategories(nextCategories);
    setSelectedCategoryCode((current) => {
      if (current && nextCategories.some((item) => item.code === current)) return current;
      return nextCategories[0]?.code || '';
    });
  }, []);

  const loadItems = React.useCallback(async (categoryCode: string): Promise<void> => {
    const requestSeq = ++itemsRequestSeq.current;
    if (!categoryCode) {
      setItems([]);
      loadedItemsCategoryRef.current = '';
      return;
    }
    const nextItems = await getParamDicts(categoryCode);
    if (requestSeq !== itemsRequestSeq.current) return;
    setItems(nextItems);
    loadedItemsCategoryRef.current = categoryCode;
  }, []);

  const reloadCurrentItems = React.useCallback(async (): Promise<void> => {
    if (!selectedCategoryCode) {
      setItems([]);
      return;
    }
    await loadItems(selectedCategoryCode);
  }, [loadItems, selectedCategoryCode]);

  const loadAll = React.useCallback(async (): Promise<void> => {
    const requestSeq = ++pageRequestSeq.current;
    setLoading(true);
    setError('');
    try {
      if (currentPage === "menus") {
        await loadMenus();
      } else if (currentPage === "param-dicts") {
        await loadCategories();
      } else if (currentPage !== 'roles') {
        await loadUsers();
      }
      if (currentPage) {
        loadedPagesRef.current.add(currentPage);
      }
    } catch (nextError: unknown) {
      if (requestSeq === pageRequestSeq.current) {
        setError(getErrorMessage(nextError, '加载系统管理数据失败。'));
      }
    } finally {
      if (requestSeq === pageRequestSeq.current) setLoading(false);
    }
  }, [currentPage, loadCategories, loadMenus, loadUsers]);

  React.useEffect(() => {
    if (currentPage && loadedPagesRef.current.has(currentPage)) {
      setLoading(false);
      setError('');
      return undefined;
    }
    loadAll();
    return () => {
      pageRequestSeq.current += 1;
    };
  }, [currentPage, loadAll]);

  React.useEffect(() => {
    if (currentPage !== "param-dicts" || !selectedCategoryCode) return;
    if (loadedItemsCategoryRef.current === selectedCategoryCode) return;
    loadItems(selectedCategoryCode).catch((nextError: unknown) => {
      setError(getErrorMessage(nextError, '加载参数字典失败。'));
    });
  }, [currentPage, loadItems, selectedCategoryCode]);

  React.useEffect(() => {
    if (!actionIntent) return;
    if (actionIntent === 'new-user') {
      guarded(() => {
        setUserErrors([]);
        setUserForm(DEFAULT_USER_FORM);
        setUserModal({ open: true, mode: 'new', initial: null, busy: false });
      });
    }
    if (actionIntent === 'new-param') {
      guarded(() => {
        setParamErrors([]);
        setParamForm((prev) => ({ ...DEFAULT_PARAM_FORM, categoryCode: selectedCategoryCode || prev.categoryCode }));
        setParamModal({ open: true, mode: 'new', initial: null, busy: false });
      });
    }
    if (actionIntent === 'new-menu') {
      guarded(() => {
        setMenuErrors([]);
        setMenuForm(DEFAULT_MENU_FORM);
        setMenuModal({ open: true, mode: 'new', initial: null, busy: false });
      });
    }
    onActionHandled?.();
  }, [actionIntent, guarded, onActionHandled, selectedCategoryCode]);

  const openNewUser = (): void =>
    guarded(() => {
      setUserErrors([]);
      setUserForm(DEFAULT_USER_FORM);
      setUserModal({ open: true, mode: 'new', initial: null, busy: false });
    });

  const openEditUser = (user: MockSystemUser): void =>
    guarded(() => {
      setUserErrors([]);
      setUserForm({
        username: user.username || '',
        displayName: user.displayName || '',
        status: user.status || 'enabled',
        role: user.role || 'admin',
        email: user.email || '',
        remark: user.remark || '',
      });
      setUserModal({ open: true, mode: 'edit', initial: user, busy: false });
    });

  const openNewParam = (): void =>
    guarded(() => {
      setParamErrors([]);
      setParamForm({ ...DEFAULT_PARAM_FORM, categoryCode: selectedCategoryCode || categories[0]?.code || '' });
      setParamModal({ open: true, mode: 'new', initial: null, busy: false });
    });

  const openEditParam = (item: ParamDictItemWithCategoryName): void =>
    guarded(() => {
      setParamErrors([]);
      setParamForm({
        categoryCode: item.categoryCode || '',
        code: item.code || '',
        name: item.name || '',
        value: item.value || '',
        status: item.status || 'enabled',
        desc: item.desc || '',
      });
      setParamModal({ open: true, mode: 'edit', initial: item, busy: false });
    });

  const openNewMenu = (): void =>
    guarded(() => {
      setMenuErrors([]);
      setMenuForm(DEFAULT_MENU_FORM);
      setMenuModal({ open: true, mode: 'new', initial: null, busy: false });
    });

  const openEditMenu = (menu: MenuItem): void =>
    guarded(() => {
      setMenuErrors([]);
      setMenuForm({
        code: menu.code || '',
        name: menu.name || '',
        icon: menu.icon || 'grid',
        path: menu.path || '',
        order: menu.order === undefined || menu.order === null ? '' : String(menu.order),
        navPlacement: menu.navPlacement || 'more',
        adminOnly: Boolean(menu.adminOnly),
        status: menu.status || 'enabled',
        desc: menu.desc || '',
      });
      setMenuModal({ open: true, mode: 'edit', initial: menu, busy: false });
    });

  const validateUserForm = (): boolean => {
    const errors: SystemFormFieldError[] = [];
    const username = userForm.username.trim();
    if (!username) errors.push({ field: 'username', message: '用户名不能为空' });
    else if (username.length > 64) {
      errors.push({ field: 'username', message: '用户名长度不能超过 64 个字符' });
    } else if (/\p{Cc}/u.test(username)) {
      errors.push({ field: 'username', message: '用户名不能包含换行、制表符等控制字符' });
    }
    if (!userForm.displayName.trim()) errors.push({ field: 'displayName', message: '显示名不能为空' });
    setUserErrors(errors);
    return !errors.length;
  };

  const validateParamForm = (): boolean => {
    const errors: SystemFormFieldError[] = [];
    if (!paramForm.categoryCode.trim()) errors.push({ field: 'categoryCode', message: '请选择参数分类' });
    if (!paramForm.code.trim()) errors.push({ field: 'code', message: '参数编码不能为空' });
    if (!paramForm.name.trim()) errors.push({ field: 'name', message: '参数名称不能为空' });
    if (!paramForm.value.trim()) errors.push({ field: 'value', message: '参数值不能为空' });
    setParamErrors(errors);
    return !errors.length;
  };

  const validateMenuForm = (): boolean => {
    const errors: SystemFormFieldError[] = [];
    if (!menuForm.code.trim()) errors.push({ field: 'code', message: '菜单编码不能为空' });
    else if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,31}$/.test(menuForm.code.trim())) {
      errors.push({ field: 'code', message: '编码需以字母开头，可包含字母、数字、_-' });
    }
    if (!menuForm.name.trim()) errors.push({ field: 'name', message: '菜单名称不能为空' });
    if (menuForm.order !== '' && !/^\d+$/.test(String(menuForm.order).trim())) {
      errors.push({ field: 'order', message: '排序号需为非负整数' });
    }
    setMenuErrors(errors);
    return !errors.length;
  };

  const handleSubmitUser = async (): Promise<void> => {
    if (!validateUserForm()) return;
    setUserModal((prev) => ({ ...prev, busy: true }));
    try {
      const payload = {
        username: userForm.username.trim(),
        displayName: userForm.displayName.trim(),
        status: userForm.status,
        role: userForm.role,
        email: userForm.email.trim(),
        remark: userForm.remark.trim(),
      };
      if (userModal.mode === 'edit' && userModal.initial?.username) {
        await updateUser(userModal.initial.username, payload);
      } else {
        await createUser(payload);
      }
      await loadUsers();
      setUserModal({ open: false, mode: 'new', initial: null, busy: false });
      setUserForm(DEFAULT_USER_FORM);
    } catch (nextError: unknown) {
      setUserErrors(getFieldErrors(nextError, '保存用户失败。'));
      setUserModal((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleSubmitParam = async (): Promise<void> => {
    if (!validateParamForm()) return;
    setParamModal((prev) => ({ ...prev, busy: true }));
    try {
      const payload = {
        categoryCode: paramForm.categoryCode.trim(),
        code: paramForm.code.trim().toUpperCase(),
        name: paramForm.name.trim(),
        value: paramForm.value.trim(),
        status: paramForm.status,
        desc: paramForm.desc.trim(),
      };
      if (paramModal.mode === 'edit' && paramModal.initial?.id) {
        await updateParamDict(paramModal.initial.id, payload);
      } else {
        await createParamDict(payload);
      }
      await loadCategories();
      if (payload.categoryCode !== selectedCategoryCode) {
        setSelectedCategoryCode(payload.categoryCode);
      } else {
        await reloadCurrentItems();
      }
      setParamModal({ open: false, mode: 'new', initial: null, busy: false });
      setParamForm(DEFAULT_PARAM_FORM);
    } catch (nextError: unknown) {
      setParamErrors([{ field: 'form', message: getErrorMessage(nextError, '保存参数失败。') }]);
      setParamModal((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleSubmitMenu = async (): Promise<void> => {
    if (!validateMenuForm()) return;
    setMenuModal((prev) => ({ ...prev, busy: true }));
    try {
      const payload: MenuPayload = {
        code: menuForm.code.trim(),
        name: menuForm.name.trim(),
        icon: menuForm.icon,
        path: menuForm.path.trim(),
        navPlacement: menuForm.navPlacement,
        adminOnly: Boolean(menuForm.adminOnly),
        status: menuForm.status,
        desc: menuForm.desc.trim(),
      };
      if (menuForm.order !== '') payload.order = Number(String(menuForm.order).trim());
      if (menuModal.mode === 'edit' && menuModal.initial?.id) {
        await updateMenu(menuModal.initial.id, payload);
      } else {
        await createMenu(payload);
      }
      await loadMenus();
      setMenuModal({ open: false, mode: 'new', initial: null, busy: false });
      setMenuForm(DEFAULT_MENU_FORM);
    } catch (nextError: unknown) {
      setMenuErrors([{ field: 'form', message: getErrorMessage(nextError, '保存菜单失败。') }]);
      setMenuModal((prev) => ({ ...prev, busy: false }));
    }
  };

  const handleChangeMenuStatus = (menu: MenuItem, status: string): void =>
    guarded(async () => {
      try {
        await updateMenuStatus(menu.id, status);
        await loadMenus();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '更新菜单状态失败。'));
      }
    });

  const handleMoveMenu = (menu: MenuItem, direction: 'up' | 'down'): void =>
    guarded(async () => {
      try {
        await moveMenu(menu.id, direction);
        await loadMenus();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '调整菜单排序失败。'));
      }
    });

  // 二次确认由列表 RowActions（confirmDelete）负责，此处直接执行删除。
  const handleDeleteMenu = (menu: MenuItem): void =>
    guarded(async () => {
      try {
        await deleteMenu(menu.id);
        await loadMenus();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '删除菜单失败。'));
      }
    });

  const handleResetPassword = (user: MockSystemUser): void =>
    guarded(async () => {
      try {
        await resetUserPassword(user.username);
        toast.success('密码已重置为当前用户名');
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '重置密码失败。'));
      }
    });

  const handleChangeUserStatus = (user: MockSystemUser, status: string): void =>
    guarded(async () => {
      try {
        await updateUserStatus(user.username, status);
        await loadUsers();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '更新用户状态失败。'));
      }
    });

  const handleChangeParamStatus = (item: ParamDictItemWithCategoryName, status: string): void =>
    guarded(async () => {
      try {
        await updateParamDictStatus(item.id, status);
        await loadCategories();
        await reloadCurrentItems();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '更新参数状态失败。'));
      }
    });

  const handleDeleteUser = (user: MockSystemUser): void =>
    guarded(async () => {
      try {
        await deleteUser(user.username);
        await loadUsers();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '删除用户失败。'));
      }
    });

  const handleDeleteParam = (item: ParamDictItemWithCategoryName): void =>
    guarded(async () => {
      try {
        await deleteParamDict(item.id);
        await loadCategories();
        await reloadCurrentItems();
      } catch (nextError: unknown) {
        toast.error(getErrorMessage(nextError, '删除参数失败。'));
      }
    });

  return {
    loading,
    error,
    users,
    categories,
    items,
    menus,
    selectedCategoryCode,
    setSelectedCategoryCode,
    userModal,
    setUserModal,
    paramModal,
    setParamModal,
    menuModal,
    setMenuModal,
    userForm,
    setUserForm,
    paramForm,
    setParamForm,
    menuForm,
    setMenuForm,
    userErrors,
    paramErrors,
    menuErrors,
    loadAll,
    openNewUser,
    openEditUser,
    openNewParam,
    openEditParam,
    openNewMenu,
    openEditMenu,
    handleSubmitUser,
    handleSubmitParam,
    handleSubmitMenu,
    handleResetPassword,
    handleChangeUserStatus,
    handleChangeParamStatus,
    handleChangeMenuStatus,
    handleMoveMenu,
    handleDeleteUser,
    handleDeleteParam,
    handleDeleteMenu,
  };
}
