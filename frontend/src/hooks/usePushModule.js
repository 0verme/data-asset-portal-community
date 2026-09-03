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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deletePushJob,
  deletePushSystem,
  getPushSystemAdminDetail,
  getPushSystems,
  savePushJob,
  savePushSystem,
} from "../api/push.ts";
import {
  DEFAULT_PUSH_FILTER,
  DEFAULT_PUSH_VIEW,
} from "../config/defaults.ts";
import {
  clearModuleNavigationState,
  getModuleListRoute,
  getPushInterfaceDetailRoute,
  getPushInterfaceEditRoute,
  getPushSystemDetailRoute,
  getPushSystemEditRoute,
} from "../routing/navigation.ts";
import {
  DEFAULT_AUTH_OPTIONS,
  DEFAULT_DELIMITER_OPTIONS,
  DEFAULT_ENCODING_OPTIONS,
  DEFAULT_FREQ_TYPE_OPTIONS,
  DEFAULT_PROTOCOL_OPTIONS,
} from "../components/push/pushConstants.js";
import { DEFAULT_UPSTREAM_DEPTS } from "../config/defaults.ts";
import { normalizeDictOptions } from "../utils/optionUtils.ts";
import { comparePushSystemImportance } from "../utils/push.ts";
import { getErrorMessage, scrollMainToTop } from "../utils/ui.ts";

function fallbackOptions(values) {
  const seen = new Set();
  return normalizeDictOptions(values).filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

export function usePushModule({
  active,
  query,
  setQuery,
  pushRoute,
  setPushRoute,
  initialView = DEFAULT_PUSH_VIEW,
  initialFilter = DEFAULT_PUSH_FILTER,
  canEdit,
  requireLogin: _requireLogin,
  runProtectedMutation,
}) {
  const [pushSystems, setPushSystems] = useState([]);
  const [pushProtocolOptions, setPushProtocolOptions] = useState([]);
  const [pushAuthOptions, setPushAuthOptions] = useState([]);
  const [pushDelimiterOptions, setPushDelimiterOptions] = useState([]);
  const [pushEncodingOptions, setPushEncodingOptions] = useState([]);
  const [pushFreqTypeOptions, setPushFreqTypeOptions] = useState([]);
  const [pushDeptOptions, setPushDeptOptions] = useState([]);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushError, setPushError] = useState("");
  const [pushLoaded, setPushLoaded] = useState(false);
  const [pushView, setPushView] = useState(initialView);
  const [pushFilter, setPushFilter] = useState(initialFilter);
  const [recentSystems, setRecentSystems] = useState([]);
  const [pushAdminDetail, setPushAdminDetail] = useState(null);
  const [pushAdminDetailLoading, setPushAdminDetailLoading] = useState(false);

  const loadPushData = useCallback(async () => {
    setPushLoading(true);
    setPushError("");
    try {
      const systems = await getPushSystems();
      const allJobs = systems.flatMap((system) => system.jobs || []);
      const protocolItems = fallbackOptions([
        ...DEFAULT_PROTOCOL_OPTIONS,
        ...systems.map((system) => system.protocol),
      ]);
      const authItems = fallbackOptions([
        ...DEFAULT_AUTH_OPTIONS,
        ...systems.map((system) => system.auth),
      ]);
      const delimiterItems = fallbackOptions([
        ...DEFAULT_DELIMITER_OPTIONS,
        ...allJobs.map((job) => job.delimiter),
      ]);
      const encodingItems = fallbackOptions([
        ...DEFAULT_ENCODING_OPTIONS,
        ...allJobs.map((job) => job.encoding),
      ]);
      const freqTypeItems = fallbackOptions([
        ...DEFAULT_FREQ_TYPE_OPTIONS,
        ...allJobs.map((job) => job.freqType),
      ]);
      const deptItems = fallbackOptions([
        ...DEFAULT_UPSTREAM_DEPTS,
        ...systems.map((system) => system.dept),
      ]);
      setPushSystems(systems);
      setPushProtocolOptions(protocolItems);
      setPushAuthOptions(authItems);
      setPushDelimiterOptions(delimiterItems);
      setPushEncodingOptions(encodingItems);
      setPushFreqTypeOptions(freqTypeItems);
      setPushDeptOptions(deptItems);
      setPushLoaded(true);
    } catch (error) {
      setPushError(getErrorMessage(error, "下游推送系统加载失败。"));
    } finally {
      setPushLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !pushLoaded && !pushLoading) {
      loadPushData();
    }
  }, [active, pushLoaded, pushLoading, loadPushData]);

  useEffect(() => {
    setPushLoaded(false);
  }, [canEdit]);

  useEffect(() => {
    setPushView(initialView || DEFAULT_PUSH_VIEW);
  }, [initialView]);

  useEffect(() => {
    setPushFilter(initialFilter || DEFAULT_PUSH_FILTER);
  }, [initialFilter]);

  useEffect(() => {
    const needsAdminDetail = canEdit && active && ["sysEdit", "jobEdit", "fields"].includes(pushRoute.page) && pushRoute.sys;
    if (!needsAdminDetail) {
      setPushAdminDetail(null);
      setPushAdminDetailLoading(false);
      return;
    }
    let alive = true;
    setPushAdminDetailLoading(true);
    setPushError("");
    getPushSystemAdminDetail(pushRoute.sys)
      .then((detail) => alive && setPushAdminDetail(detail))
      .catch((error) => alive && setPushError(getErrorMessage(error, "下游推送系统详情加载失败。")))
      .finally(() => alive && setPushAdminDetailLoading(false));
    return () => { alive = false; };
  }, [active, canEdit, pushRoute.page, pushRoute.sys]);

  const pushGoList = useCallback(() => {
    clearModuleNavigationState("push");
    setPushRoute(getModuleListRoute("push"));
    scrollMainToTop();
  }, [setPushRoute]);
  const pushGoSystem = useCallback((systemId) => {
    rememberSystem(systemId);
    setPushRoute(getPushSystemDetailRoute(systemId));
    scrollMainToTop();
  }, [setPushRoute]);
  const pushGoJob = useCallback((systemId, jobId) => {
    rememberSystem(systemId);
    setPushRoute(getPushInterfaceDetailRoute(systemId, jobId));
    scrollMainToTop();
  }, [setPushRoute]);
  const pushGoSystemEdit = useCallback((systemId) => {
    setPushRoute(getPushSystemEditRoute(systemId));
    scrollMainToTop();
  }, [setPushRoute]);
  const pushGoJobEdit = useCallback((systemId, jobId) => {
    setPushRoute(getPushInterfaceEditRoute(systemId, jobId));
    scrollMainToTop();
  }, [setPushRoute]);
  const resetPushNavigation = useCallback(() => {
    clearModuleNavigationState("push");
    setQuery("");
    setPushView(DEFAULT_PUSH_VIEW);
    setPushFilter(DEFAULT_PUSH_FILTER);
    setPushRoute(getModuleListRoute("push"));
  }, [setPushRoute, setQuery]);
  const rememberSystem = (systemId) => {
    setRecentSystems((prev) => [systemId, ...prev.filter((item) => item !== systemId)].slice(0, 6));
  };
  const pushOpenSystem = (systemId) => {
    pushGoSystem(systemId);
  };
  const pushOpenJob = (systemId, jobId) => {
    pushGoJob(systemId, jobId);
  };

  const handleSavePushSystem = async (system, oldId) => {
    await runProtectedMutation(async () => {
      await savePushSystem(system, oldId);
      await loadPushData();
      clearModuleNavigationState("push");
      setPushRoute(getPushSystemDetailRoute(system.id));
      rememberSystem(system.id);
      scrollMainToTop();
    }, "保存下游系统失败。", "push:write");
  };
  const handleDeletePushSystem = async (systemId) => {
    await runProtectedMutation(async () => {
      await deletePushSystem(systemId);
      await loadPushData();
      clearModuleNavigationState("push");
      setQuery("");
      setPushView(DEFAULT_PUSH_VIEW);
      setPushFilter(DEFAULT_PUSH_FILTER);
      setPushRoute(getModuleListRoute("push"));
      scrollMainToTop();
    }, "删除下游系统失败。", "push:write");
  };
  const handleSavePushJob = async (job, oldId) => {
    if (!pushRoute.sys) return;
    await runProtectedMutation(async () => {
      await savePushJob(pushRoute.sys, job, oldId);
      await loadPushData();
      clearModuleNavigationState("push");
      setPushRoute(getPushInterfaceDetailRoute(pushRoute.sys, job.id));
      scrollMainToTop();
    }, "保存推送作业失败。", "push:write");
  };
  const handleDeletePushJob = async (jobId) => {
    if (!pushRoute.sys) return;
    await runProtectedMutation(async () => {
      await deletePushJob(pushRoute.sys, jobId);
      await loadPushData();
      setPushRoute(getPushSystemDetailRoute(pushRoute.sys));
      scrollMainToTop();
    }, "删除推送作业失败。", "push:write");
  };

  const filteredPushSystems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pushSystems.filter((system) => {
      if (pushFilter.status && system.status !== pushFilter.status) return false;
      if (pushFilter.protocol && system.protocol !== pushFilter.protocol) return false;
      if (pushFilter.dept && system.dept !== pushFilter.dept) return false;
      if (pushFilter.importanceLevel && system.importanceLevel !== pushFilter.importanceLevel) return false;
      if (!normalizedQuery) return true;
      return (
        system.name.toLowerCase().includes(normalizedQuery) ||
        system.id.toLowerCase().includes(normalizedQuery) ||
        system.jobs.some((job) =>
          job.cn.toLowerCase().includes(normalizedQuery) ||
          job.sourceFileName.toLowerCase().includes(normalizedQuery) ||
          job.targetFileName.toLowerCase().includes(normalizedQuery))
      );
    }).sort(comparePushSystemImportance);
  }, [pushSystems, query, pushFilter]);

  const pushFacets = useMemo(() => pushSystems.reduce((acc, system) => {
    acc.status[system.status] = (acc.status[system.status] || 0) + 1;
    acc.protocol[system.protocol] = (acc.protocol[system.protocol] || 0) + 1;
    acc.dept[system.dept] = (acc.dept[system.dept] || 0) + 1;
    acc.importanceLevel[system.importanceLevel] = (acc.importanceLevel[system.importanceLevel] || 0) + 1;
    return acc;
  }, { status: {}, protocol: {}, dept: {}, importanceLevel: {} }), [pushSystems]);

  const currentSystem = useMemo(() => (
    pushRoute.sys ? pushSystems.find((system) => system.id === pushRoute.sys) || null : null
  ), [pushSystems, pushRoute.sys]);

  const currentJob = useMemo(() => {
    if (!currentSystem || !pushRoute.job) return null;
    return currentSystem.jobs.find((job) => job.id === pushRoute.job) || null;
  }, [currentSystem, pushRoute.job]);

  const pushIds = useMemo(() => pushSystems.map((system) => system.id), [pushSystems]);
  const pushDepts = useMemo(() => pushDeptOptions.filter((item) => item.value), [pushDeptOptions]);
  const recentPushSystems = useMemo(() => (
    recentSystems
      .map((id) => pushSystems.find((system) => system.id === id))
      .filter(Boolean)
  ), [recentSystems, pushSystems]);

  return {
    pushSystems,
    pushProtocolOptions,
    pushAuthOptions,
    pushDelimiterOptions,
    pushEncodingOptions,
    pushFreqTypeOptions,
    pushLoading,
    pushError,
    pushLoaded,
    loadPushData,
    pushView,
    setPushView,
    pushFilter,
    setPushFilter,
    pushGoList,
    pushGoSystem,
    pushGoJob,
    pushGoSystemEdit,
    pushGoJobEdit,
    resetPushNavigation,
    pushOpenSystem,
    pushOpenJob,
    handleSavePushSystem,
    handleDeletePushSystem,
    handleSavePushJob,
    handleDeletePushJob,
    filteredPushSystems,
    pushFacets,
    currentSystem,
    currentJob,
    pushIds,
    pushDepts,
    recentPushSystems,
    pushAdminDetail,
    pushAdminDetailLoading,
  };
}
