import type { SystemRoute } from "../../routing/types.ts";
import type { UseRoleModuleResult } from "../../hooks/useRoleModule.ts";
import type { UseSystemModuleResult } from "../../hooks/useSystemModule.ts";
import { Icon } from "../ui.tsx";
import { FormModal } from "../common/index.ts";
import { useRoleModule } from "../../hooks/useRoleModule.ts";
import { useSystemModule } from "../../hooks/useSystemModule.ts";
import { UserForm } from "./UserForm.tsx";
import { ParamForm } from "./ParamForm.tsx";
import { MenuForm } from "./MenuForm.tsx";
import { UserManagementPage } from "./UserManagementPage.tsx";
import { ParamDictPage } from "./ParamDictPage.tsx";
import { MenuManagementPage } from "./MenuManagementPage.tsx";
import { RoleForm, RoleManagementPage } from "./RoleManagementPage.tsx";

export interface SystemManagementPageProps {
  route: SystemRoute;
  query: string;
  canEdit: boolean;
  requireLogin: (action?: () => void, permission?: string) => boolean;
  actionIntent?: string | undefined;
  onActionHandled: () => void;
}

export function SystemManagementPage({
  route,
  query,
  canEdit,
  requireLogin,
  actionIntent,
  onActionHandled,
}: SystemManagementPageProps) {
  const systemModule: UseSystemModuleResult = useSystemModule({ page: route.page, requireLogin, actionIntent, onActionHandled });
  const {
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
  } = systemModule;
  const roleModule: UseRoleModuleResult = useRoleModule({
    active: route.page === "roles" || route.page === "users",
    requireLogin,
    actionIntent,
    onActionHandled,
  });

  if (loading || (route.page === "roles" && roleModule.loading)) {
    return (
      <div className="state-card" role="status" aria-live="polite">
        <div className="state-spinner" aria-hidden="true"></div>
        <h4>加载系统管理模块</h4>
        <p>正在加载当前子页面所需数据。</p>
      </div>
    );
  }

  if (error || (route.page === "roles" && roleModule.error)) {
    return (
      <div className="state-card state-card-error" role="alert">
        <div className="ec"><Icon name="inbox" size={24} /></div>
        <h4>系统管理加载失败</h4>
        <p>{error || roleModule.error}</p>
        <button className="btn state-btn" type="button" onClick={route.page === "roles" ? () => void roleModule.load() : () => void loadAll()}>重新加载</button>
      </div>
    );
  }

  return (
    <>
      {route.page === "roles" ? (
        <RoleManagementPage
          roles={roleModule.roles}
          permissions={roleModule.permissions}
          query={query}
          canEdit={canEdit}
          onNew={roleModule.openNew}
          onEdit={roleModule.openEdit}
          onDelete={roleModule.remove}
          deletingRoleCode={roleModule.deletingRoleCode}
        />
      ) : route.page === "menus" ? (
        <MenuManagementPage menus={menus} query={query} canEdit={canEdit} onNew={openNewMenu} onEdit={openEditMenu} onChangeStatus={handleChangeMenuStatus} onMove={handleMoveMenu} />
      ) : route.page === "param-dicts" ? (
        <ParamDictPage categories={categories} items={items} selectedCategoryCode={selectedCategoryCode} query={query} canEdit={canEdit} onPickCategory={setSelectedCategoryCode} onNew={openNewParam} onEdit={openEditParam} onChangeStatus={handleChangeParamStatus} />
      ) : (
        <UserManagementPage users={users} query={query} canEdit={canEdit} onNew={openNewUser} onEdit={openEditUser} onResetPassword={handleResetPassword} onChangeStatus={handleChangeUserStatus} />
      )}

      <FormModal
        open={userModal.open}
        title={userModal.mode === "edit" ? "编辑用户" : "新增用户"}
        subtitle={userModal.mode === "edit" ? `正在编辑：${userModal.initial?.username || "-"}` : "创建新的用户账号"}
        icon="user"
        onClose={() => !userModal.busy && setUserModal({ open: false, mode: "new", initial: null, busy: false })}
        onSubmit={handleSubmitUser}
        submitText={userModal.mode === "edit" ? "保存修改" : "创建"}
        busy={userModal.busy}
      >
        <UserForm form={userForm} setForm={setUserForm} roles={roleModule.roles} errors={userErrors} mode={userModal.mode} initial={userModal.initial} onDelete={handleDeleteUser} />
      </FormModal>

      <FormModal
        open={roleModule.modal.open}
        title={roleModule.modal.mode === "edit" ? "编辑角色" : "新增角色"}
        subtitle={roleModule.modal.mode === "edit" ? `正在编辑：${roleModule.modal.initial?.roleCode || "-"}` : "创建新的自定义角色"}
        icon="shield"
        onClose={() => !roleModule.modal.busy && roleModule.setModal({ open: false, mode: "new", initial: null, busy: false })}
        onSubmit={roleModule.submit}
        submitText={roleModule.modal.mode === "edit" ? "保存修改" : "创建"}
        busy={roleModule.modal.busy}
      >
        <RoleForm form={roleModule.form} setForm={roleModule.setForm} permissions={roleModule.permissions} errors={roleModule.errors} mode={roleModule.modal.mode} initial={roleModule.modal.initial} onDelete={roleModule.remove} />
      </FormModal>

      <FormModal
        open={paramModal.open}
        title={paramModal.mode === "edit" ? "编辑参数" : "新增参数"}
        subtitle={paramModal.mode === "edit" ? `正在编辑：${paramModal.initial?.code || "-"}` : "创建新的参数字典"}
        icon="book"
        onClose={() => !paramModal.busy && setParamModal({ open: false, mode: "new", initial: null, busy: false })}
        onSubmit={handleSubmitParam}
        submitText={paramModal.mode === "edit" ? "保存修改" : "创建"}
        busy={paramModal.busy}
      >
        <ParamForm form={paramForm} categories={categories} setForm={setParamForm} errors={paramErrors} mode={paramModal.mode} initial={paramModal.initial} onDelete={handleDeleteParam} />
      </FormModal>

      <FormModal
        open={menuModal.open}
        title={menuModal.mode === "edit" ? "编辑菜单" : "新增菜单"}
        subtitle={menuModal.mode === "edit" ? `正在编辑：${menuModal.initial?.name || "-"}` : "创建新的菜单配置"}
        icon="layers"
        onClose={() => !menuModal.busy && setMenuModal({ open: false, mode: "new", initial: null, busy: false })}
        onSubmit={handleSubmitMenu}
        submitText={menuModal.mode === "edit" ? "保存修改" : "创建"}
        busy={menuModal.busy}
      >
        <MenuForm form={menuForm} setForm={setMenuForm} errors={menuErrors} mode={menuModal.mode} initial={menuModal.initial} onDelete={handleDeleteMenu} />
      </FormModal>
    </>
  );
}
