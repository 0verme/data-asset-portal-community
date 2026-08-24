import { UpstreamDetail, UpstreamEditor, UpstreamList } from "../UpstreamPages.jsx";
import { Icon } from "../ui.jsx";
import { confirmDeleteAction, ErrorState, LoadingState } from "../common/index.js";

const confirmDeleteUpstream = (system, run) => async () => {
  if (!system) return;
  if (await confirmDeleteAction({
    name: system.name || system.id,
    typeLabel: "上游卸数系统",
    impact: "该系统删除后，可能影响入仓表清单、卸数计划、字段映射和历史记录。若该系统不再使用，建议优先停用。",
    consequences: [
      "删除前必须校验是否存在入仓表、字段映射、卸数计划和历史记录。",
      "存在任一关联时，应由后端拒绝删除并返回明确原因。",
    ],
    confirmKeyword: system.id || "",
    confirmKeywordLabel: "请输入系统标识二次确认",
  })) {
    run(system.id);
  }
};

export function UpstreamView({ upstream, query, statusOptions, requireLogin, upRoute, setUpRoute, onViewTables }) {
  const {
    upstreamDbTypes,
    upstreamDeptOptions,
    currentUpstream,
    upstreamPendingIds,
    upstreamLoading,
    upstreamDetailLoading,
    upstreamError,
    upstreamSaveError,
    setUpstreamSaveError,
    upstreamView,
    setUpstreamView,
    loadUpstreamData,
    loadUpstreamDetail,
    upBack,
    upGoList,
    upGoDetail,
    upGoEdit,
    upOpen,
    handleSaveUpstream,
    handleDeleteUpstream,
    handleToggleUpstream,
    filteredUpstreamSystems,
    currentUpstreamEdit,
  } = upstream;

  if (upstreamLoading) {
    return <LoadingState title="加载上游卸数配置" desc="正在准备系统清单和卸数计划。" />;
  }
  if (upstreamError && !["detail", "edit"].includes(upRoute.page)) {
    return <ErrorState title="上游卸数加载失败" desc={upstreamError} onRetry={loadUpstreamData} />;
  }
  if (upRoute.page === "list") {
    return (
      <UpstreamList
        systems={filteredUpstreamSystems}
        pendingIds={upstreamPendingIds}
        query={query}
        view={upstreamView}
        onChangeView={setUpstreamView}
        statusOptions={statusOptions}
        onOpen={upOpen}
        onEdit={(id) => requireLogin(() => upGoEdit(id))}
        onNew={() => requireLogin(() => {
          setUpRoute({ page: "new", id: null });
        })}
        onToggle={handleToggleUpstream}
        onViewTables={onViewTables}
      />
    );
  }
  if (upRoute.page === "detail") {
    if (upstreamDetailLoading) {
      return <LoadingState title="加载上游系统详情" desc="正在准备系统连接和卸数时间点。" />;
    }
    if (upstreamError) {
      return <ErrorState title="上游系统详情加载失败" desc={upstreamError} onRetry={() => loadUpstreamDetail(upRoute.id)} />;
    }
    if (!currentUpstream) {
      return <div className="empty"><div className="ec"><Icon name="inbox" size={26} /></div><h4>系统不存在</h4></div>;
    }
    return <UpstreamDetail system={currentUpstream} statusOptions={statusOptions} dbTypeOptions={upstreamDbTypes} deptOptions={upstreamDeptOptions} onBack={upGoList} onBackToList={upGoList} onEdit={() => requireLogin(() => upGoEdit(currentUpstream.id))} />;
  }
  if (upRoute.page === "new") {
    return <UpstreamEditor mode="new" dbTypeOptions={upstreamDbTypes} deptOptions={upstreamDeptOptions} statusOptions={statusOptions} onSave={handleSaveUpstream} onCancel={upBack} onBackToList={upGoList} saveError={upstreamSaveError} onClearSaveError={() => setUpstreamSaveError("")} />;
  }
  if (upRoute.page === "edit") {
    if (upstreamDetailLoading && !currentUpstreamEdit) {
      return <LoadingState title="加载编辑页" desc="正在准备系统元数据和卸数配置。" />;
    }
    if (upstreamError && !currentUpstreamEdit) {
      return <ErrorState title="编辑页加载失败" desc={upstreamError} onRetry={() => loadUpstreamDetail(upRoute.id)} />;
    }
    if (!currentUpstreamEdit) {
      return <div className="empty"><div className="ec"><Icon name="inbox" size={26} /></div><h4>系统不存在</h4></div>;
    }
    return <UpstreamEditor mode="edit" initial={currentUpstreamEdit} dbTypeOptions={upstreamDbTypes} deptOptions={upstreamDeptOptions} statusOptions={statusOptions} onSave={handleSaveUpstream} onCancel={() => upGoDetail(currentUpstreamEdit.id)} onBackToList={upGoList} onBackToDetail={() => upGoDetail(currentUpstreamEdit.id)} onDelete={confirmDeleteUpstream(currentUpstreamEdit, handleDeleteUpstream)} saveError={upstreamSaveError} onClearSaveError={() => setUpstreamSaveError("")} />;
  }
  return <div className="empty"><div className="ec"><Icon name="inbox" size={26} /></div><h4>页面不存在</h4></div>;
}
