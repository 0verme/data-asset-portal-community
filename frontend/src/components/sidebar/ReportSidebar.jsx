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


import { DEFAULT_REPORT_FILTER } from "../../config/defaults.ts";
import { SidebarActionGroup } from "./common/SidebarActionGroup.jsx";
import { SidebarFilterGroup } from "./common/SidebarFilterGroup.jsx";
import { StatusFilterGroup } from "./common/StatusFilterGroup.jsx";

export function ReportSidebar({ report, requireLogin, canEdit = false, setReportRoute }) {
  const { reports, reportFilter, setReportFilter, reportFacets } = report;
  // Report type is a facet of the current report-asset response, not a
  // common-code endpoint. This also preserves types added in the database.
  const reportTypeOptions = Object.keys(reportFacets.type)
    .map((value) => ({ value, name: value }));

  return (
    <>
      <SidebarFilterGroup
        title="报表类型"
        allOption={{
          key: "all-report-types",
          label: "全部报表类型",
          count: reports.length,
          active: !reportFilter.type,
          onClick: () => setReportFilter((prev) => ({ ...prev, type: null })),
        }}
        items={reportTypeOptions
          .filter((item) => reportFacets.type[item.value])
          .map((item) => ({
            key: item.value,
            label: item.name,
            count: reportFacets.type[item.value] || 0,
            active: reportFilter.type === item.value,
            onClick: () => setReportFilter((prev) => ({ ...prev, type: prev.type === item.value ? null : item.value })),
          }))}
      />

      <StatusFilterGroup
        value={reportFilter.status}
        allValue={DEFAULT_REPORT_FILTER.status}
        enabledValue="enabled"
        disabledValue="disabled"
        totalCount={reports.length}
        enabledCount={reportFacets.status.enabled || 0}
        disabledCount={reportFacets.status.disabled || 0}
        onChange={(status) => setReportFilter((prev) => ({ ...prev, status }))}
      />

      <SidebarFilterGroup
        title="归属部门"
        allOption={{
          key: "all-owner-depts",
          label: "全部归属部门",
          count: reports.length,
          active: !reportFilter.ownerDept,
          onClick: () => setReportFilter((prev) => ({ ...prev, ownerDept: null })),
        }}
        items={Object.entries(reportFacets.ownerDept)
          .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"))
          .map(([ownerDept, count]) => ({
            key: ownerDept,
            label: ownerDept,
            count,
            active: reportFilter.ownerDept === ownerDept,
            onClick: () => setReportFilter((prev) => ({ ...prev, ownerDept: prev.ownerDept === ownerDept ? null : ownerDept })),
          }))}
      />

      <SidebarActionGroup
        actions={canEdit ? [{
          key: "create-report",
          label: "新增报表",
          onClick: () => requireLogin(() => setReportRoute({ page: "new", code: null })),
        }] : []}
      />
    </>
  );
}
