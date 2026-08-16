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

import React from "react";
import {
  JobEditor,
  PushJobDetail,
  PushJobList,
  PushSystemList,
  SystemEditor,
} from "../PushPages.jsx";
import { Icon } from "../ui.jsx";
import { EmptyState, ErrorState, LoadingState, ViewModeSwitcher } from "../common/index.js";

export function PushView({ push, query, statusOptions, requireLogin, canEdit, pushRoute, setPushRoute }) {
  const {
    pushSystems,
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
    return <LoadingState title="加载下游推送配置" desc="正在准备系统清单、作业和筛选信息。" />;
  }
  if (pushError) {
    return <ErrorState title="下游推送加载失败" desc={pushError} onRetry={loadPushData} />;
  }
  if (pushRoute.page === "systems") {
    return (
      <>
        <div className="page-head">
          <div>
            <div className="page-title"><Icon name="upload" size={21} color="var(--ink-2)" />下游系统推送</div>
            <div className="page-sub">共 <b>{filteredPushSystems.length}</b> 个系统</div>
          </div>
          <div className="head-actions">
            <ViewModeSwitcher value={pushView} onChange={setPushView} modes={["card", "list"]} />
            <button className="btn primary" onClick={() => requireLogin(() => pushGoSystemEdit(null))}><Icon name="plus" size={15} />新增系统</button>
          </div>
        </div>
        <PushSystemList systems={filteredPushSystems} query={query} view={pushView} onOpen={pushOpenSystem} />
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
        onEditSystem={() => requireLogin(() => pushGoSystemEdit(currentSystem.id))}
        onNewJob={() => requireLogin(() => pushGoJobEdit(currentSystem.id, null))}
        onEditJob={(jobId) => requireLogin(() => pushGoJobEdit(currentSystem.id, jobId))}
      />
    );
  }
  if (pushRoute.page === "fields" && currentSystem && currentJob) {
    if (canEdit && pushAdminDetailLoading) {
      return <LoadingState title="加载作业详情" desc="正在加载文件头信息和字段清单。" />;
    }
    const detailSystem = canEdit ? pushAdminDetail : null;
    const detailJob = detailSystem?.jobs?.find((job) => job.id === currentJob.id) || null;
    return (
      <PushJobDetail
        system={detailSystem || currentSystem}
        job={detailJob || currentJob}
        showDetails={Boolean(detailJob)}
        onBackSystems={pushGoList}
        onBackJobs={() => pushGoSystem(currentSystem.id)}
        onEdit={() => requireLogin(() => pushGoJobEdit(currentSystem.id, currentJob.id))}
      />
    );
  }
  if (pushRoute.page === "sysNew") {
    return <SystemEditor mode="new" existingIds={pushIds} depts={pushDepts} protocolOptions={pushProtocolOptions} authOptions={pushAuthOptions} statusOptions={statusOptions} onSave={handleSavePushSystem} onCancel={pushGoList} onBackToList={pushGoList} />;
  }
  if (pushRoute.page === "sysEdit" && currentSystem) {
    if (pushAdminDetailLoading) return <LoadingState title="加载系统编辑页" desc="正在加载管理员维护信息。" />;
    if (!pushAdminDetail) return <ErrorState title="系统编辑信息不可用" desc={pushError || "无法加载管理员维护信息。"} onRetry={loadPushData} />;
    return <SystemEditor mode="edit" initial={pushAdminDetail} existingIds={pushIds} depts={pushDepts} protocolOptions={pushProtocolOptions} authOptions={pushAuthOptions} statusOptions={statusOptions} onSave={handleSavePushSystem} onCancel={() => pushGoSystem(currentSystem.id)} onBackToList={pushGoList} onBackToDetail={() => pushGoSystem(currentSystem.id)} onDelete={handleDeletePushSystem} />;
  }
  if (pushRoute.page === "jobNew" && currentSystem) {
    return <JobEditor mode="new" system={currentSystem} delimiterOptions={pushDelimiterOptions} encodingOptions={pushEncodingOptions} freqTypeOptions={pushFreqTypeOptions} onSave={handleSavePushJob} onCancel={() => pushGoSystem(currentSystem.id)} onBackToList={pushGoList} onBackToSystem={() => pushGoSystem(currentSystem.id)} />;
  }
  if (pushRoute.page === "jobEdit" && currentSystem && currentJob) {
    if (pushAdminDetailLoading) return <LoadingState title="加载作业编辑页" desc="正在加载管理员维护信息。" />;
    const adminJob = pushAdminDetail?.jobs?.find((job) => job.id === currentJob.id);
    if (!adminJob) return <ErrorState title="作业编辑信息不可用" desc={pushError || "无法加载管理员维护信息。"} onRetry={loadPushData} />;
    return <JobEditor mode="edit" system={pushAdminDetail} initial={adminJob} delimiterOptions={pushDelimiterOptions} encodingOptions={pushEncodingOptions} freqTypeOptions={pushFreqTypeOptions} onSave={handleSavePushJob} onCancel={() => pushGoJob(currentSystem.id, currentJob.id)} onBackToList={pushGoList} onBackToSystem={() => pushGoSystem(currentSystem.id)} onBackToJob={() => pushGoJob(currentSystem.id, currentJob.id)} onDelete={handleDeletePushJob} />;
  }
  return <EmptyState title="页面不存在" />;
}
