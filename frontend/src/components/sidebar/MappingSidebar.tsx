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

export function MappingSidebar() {
  return (
    <>
      <div className="side-group">
        <div className="side-title">查询说明</div>
        <div className="side-item active">源字段到 DWF 字段映射</div>
        <div className="side-item disabled">字段维度与表维度双视图</div>
        <div className="side-item disabled">支持按当前结果导出 CSV</div>
      </div>

      <div className="side-group">
        <div className="side-title">筛选建议</div>
        <div className="side-item disabled">先按源系统缩小范围</div>
        <div className="side-item disabled">空注释可快速定位待治理字段</div>
      </div>
    </>
  );
}
