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

import type { UsePushModuleResult } from "../../hooks/usePushModule.ts";
import type { PushRoute } from "../../routing/types.ts";
import type { OptionInputItem } from "../../utils/optionUtils.ts";
import type { ViewMode } from "../common/ViewModeSwitcher.tsx";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  ViewModeSwitcher,
} from "../common/index.ts";
import {
  JobEditor,
  PushJobDetail,
  PushJobList,
  PushSystemList,
  SystemEditor,
} from "../PushPages.tsx";
import { Icon } from "../ui.tsx";

type RequireLogin = (action?: () => void, permission?: string) => boolean;

export interface PushViewProps {
  push: UsePushModuleResult;
  query: string;
  statusOptions: readonly OptionInputItem[];
  requireLogin: RequireLogin;
  canEdit: boolean;
  pushRoute: PushRoute;
}

export function PushView({
  push,
  query,
  statusOptions,
  requireLogin,
  canEdit,
  pushRoute,
}: PushViewProps) {
  const {
    pushProtocolOptions,
    pushAuthOptions,
    pushDelimiterOptions,
    pushEncodingOptions,
    pushFreqTypeOptions,
    pushLoading,
    pushError,
    loadPushData,
    pushView,
    setPushView,
    pushGoList,
    pushGoSystem,
    pushGoJob,
    pushGoSystemEdit,
    pushGoJobEdit,
    pushOpenSystem,
    handleSavePushSystem,
    handleDeletePushSystem,
    handleSavePushJob,
    handleDeletePushJob,
    filteredPushSystems,
    currentSystem,
    currentJob,
    pushAdminDetail,
    pushAdminDetailLoading,
    pushIds,
    pushDepts,
  } = push;

  if (pushLoading) {
    return (
      <LoadingState
        title="加载下游推送配置"
        desc="正在准备系统清单、作业和筛选信息。"
      />
    );
  }
  if (pushError) {
    return (
      <ErrorState
        title="下游推送加载失败"
        desc={pushError}
        onRetry={loadPushData}
      />
    );
  }
  if (
    !canEdit &&
    ["sysNew", "sysEdit", "jobNew", "jobEdit"].includes(pushRoute.page)
  ) {
    return (
      <EmptyState
        title="当前页面需要下游推送维护权限"
        desc="下游推送目录可以公开浏览，新增和编辑需要相应写权限。"
      />
    );
  }
  if (pushRoute.page === "systems") {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title">
              <Icon name="upload" size={21} color="var(--ink-2)" />
              下游系统推送
            </div>
            <div className="page-sub">
              共 <b>{filteredPushSystems.length}</b> 个系统
            </div>
          </div>
          <div className="head-actions">
            <ViewModeSwitcher
              value={pushView as ViewMode}
              onChange={setPushView}
              modes={["card", "list"] as const}
            />
            {canEdit ? (
              <button
                className="btn primary"
                type="button"
                onClick={() =>
                  requireLogin(() => pushGoSystemEdit(null), "push:write")
                }
              >
                <Icon name="plus" size={15} />
                新增系统
              </button>
            ) : null}
          </div>
        </div>
        <PushSystemList
          systems={filteredPushSystems}
          query={query}
          view={pushView}
          onOpen={pushOpenSystem}
        />
      </>
    );
  }
  if (pushRoute.page === "jobs" && currentSystem) {
    return (
      <PushJobList
        system={currentSystem}
        query={query}
        onBack={pushGoList}
        onOpen={(jobId) => pushGoJob(currentSystem.id, jobId)}
        onEditSystem={
          canEdit
            ? () =>
                requireLogin(
                  () => pushGoSystemEdit(currentSystem.id),
                  "push:write",
                )
            : undefined
        }
        onNewJob={
          canEdit
            ? () =>
                requireLogin(
                  () => pushGoJobEdit(currentSystem.id, null),
                  "push:write",
                )
            : undefined
        }
        onEditJob={
          canEdit
            ? (jobId) =>
                requireLogin(
                  () => pushGoJobEdit(currentSystem.id, jobId),
                  "push:write",
                )
            : undefined
        }
        canEdit={canEdit}
      />
    );
  }
  if (pushRoute.page === "fields" && currentSystem && currentJob) {
    if (canEdit && pushAdminDetailLoading) {
      return (
        <LoadingState
          title="加载作业详情"
          desc="正在加载文件头信息和字段清单。"
        />
      );
    }
    const detailSystem = canEdit ? pushAdminDetail : null;
    const detailJob =
      detailSystem?.jobs?.find((job) => job.id === currentJob.id) || null;
    return (
      <PushJobDetail
        system={detailSystem || currentSystem}
        job={detailJob || currentJob}
        showDetails={Boolean(detailJob)}
        onBackSystems={pushGoList}
        onBackJobs={() => pushGoSystem(currentSystem.id)}
        onEdit={
          canEdit
            ? () =>
                requireLogin(
                  () => pushGoJobEdit(currentSystem.id, currentJob.id),
                  "push:write",
                )
            : undefined
        }
      />
    );
  }
  if (pushRoute.page === "sysNew") {
    return (
      <SystemEditor
        mode="new"
        existingIds={pushIds}
        depts={pushDepts}
        protocolOptions={pushProtocolOptions}
        authOptions={pushAuthOptions}
        statusOptions={statusOptions}
        onSave={handleSavePushSystem}
        onCancel={pushGoList}
        onBackToList={pushGoList}
      />
    );
  }
  if (pushRoute.page === "sysEdit" && currentSystem) {
    if (pushAdminDetailLoading)
      return (
        <LoadingState title="加载系统编辑页" desc="正在加载管理员维护信息。" />
      );
    if (!pushAdminDetail)
      return (
        <ErrorState
          title="系统编辑信息不可用"
          desc={pushError || "无法加载管理员维护信息。"}
          onRetry={loadPushData}
        />
      );
    return (
      <SystemEditor
        mode="edit"
        initial={pushAdminDetail}
        existingIds={pushIds}
        depts={pushDepts}
        protocolOptions={pushProtocolOptions}
        authOptions={pushAuthOptions}
        statusOptions={statusOptions}
        onSave={handleSavePushSystem}
        onCancel={() => pushGoSystem(currentSystem.id)}
        onBackToList={pushGoList}
        onBackToDetail={() => pushGoSystem(currentSystem.id)}
        onDelete={handleDeletePushSystem}
      />
    );
  }
  if (pushRoute.page === "jobNew" && currentSystem) {
    return (
      <JobEditor
        mode="new"
        system={currentSystem}
        delimiterOptions={pushDelimiterOptions}
        encodingOptions={pushEncodingOptions}
        freqTypeOptions={pushFreqTypeOptions}
        onSave={handleSavePushJob}
        onCancel={() => pushGoSystem(currentSystem.id)}
        onBackToList={pushGoList}
        onBackToSystem={() => pushGoSystem(currentSystem.id)}
      />
    );
  }
  if (pushRoute.page === "jobEdit" && currentSystem && currentJob) {
    if (pushAdminDetailLoading)
      return (
        <LoadingState title="加载作业编辑页" desc="正在加载管理员维护信息。" />
      );
    if (!pushAdminDetail)
      return (
        <ErrorState
          title="作业编辑信息不可用"
          desc={pushError || "无法加载管理员维护信息。"}
          onRetry={loadPushData}
        />
      );
    const adminJob = pushAdminDetail.jobs.find(
      (job) => job.id === currentJob.id,
    );
    if (!adminJob)
      return (
        <ErrorState
          title="作业编辑信息不可用"
          desc={pushError || "无法加载管理员维护信息。"}
          onRetry={loadPushData}
        />
      );
    return (
      <JobEditor
        mode="edit"
        system={pushAdminDetail}
        initial={adminJob}
        delimiterOptions={pushDelimiterOptions}
        encodingOptions={pushEncodingOptions}
        freqTypeOptions={pushFreqTypeOptions}
        onSave={handleSavePushJob}
        onCancel={() => pushGoJob(currentSystem.id, currentJob.id)}
        onBackToList={pushGoList}
        onBackToSystem={() => pushGoSystem(currentSystem.id)}
        onBackToJob={() => pushGoJob(currentSystem.id, currentJob.id)}
        onDelete={handleDeletePushJob}
      />
    );
  }
  return <EmptyState title="页面不存在" />;
}
