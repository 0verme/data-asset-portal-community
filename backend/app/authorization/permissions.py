# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Stable Community RBAC permission registry.

This module is the P0 contract, not an HTTP enforcement layer.  It contains
only immutable permission definitions and the compatibility mappings that P1
will persist.  No FastAPI, Request, Session, database, or frontend dependency
belongs here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

ADMIN_ROLE = "admin"
MAINTAINER_ROLE = "maintainer"


@dataclass(frozen=True, slots=True)
class PermissionDefinition:
    """A stable, auditable permission code and its business meaning."""

    code: str
    resource: str
    action: str
    name: str
    description: str


def _permission(
    code: str,
    name: str,
    description: str,
) -> PermissionDefinition:
    resource, action = code.rsplit(":", 1)
    return PermissionDefinition(
        code=code,
        resource=resource,
        action=action,
        name=name,
        description=description,
    )


# Keep this tuple ordered for deterministic seeds, API responses, snapshots,
# and documentation.  New codes append to the relevant resource group.
PERMISSION_DEFINITIONS: tuple[PermissionDefinition, ...] = (
    _permission("asset:read", "数据资产读取", "查询数据表、字段、DDL 和资产筛选信息。"),
    _permission("asset:write", "数据资产维护", "创建、更新字段、删除数据资产。"),
    _permission("root:read", "词根读取", "查询词根及词根分类。"),
    _permission("root:write", "词根维护", "创建、更新、删除和导入词根。"),
    _permission("indicator:read", "指标读取", "查询指标及指标详情。"),
    _permission("indicator:write", "指标维护", "创建、更新、删除和变更指标状态。"),
    _permission("report:read", "报表读取", "查询报表资产及详情。"),
    _permission("report:write", "报表维护", "创建、更新和删除报表资产。"),
    _permission("api_asset:read", "API 资产读取", "查询 API 资产及其关联信息。"),
    _permission(
        "api_asset:write", "API 资产维护", "维护 API 资产、参数、响应字段和关系。"
    ),
    _permission("upstream:read", "上游系统受限读取", "读取受保护的上游系统管理详情。"),
    _permission("upstream:write", "上游系统维护", "创建、更新、停用和删除上游系统。"),
    _permission("push:read", "下游推送受限读取", "读取受保护的下游系统管理详情。"),
    _permission("push:write", "下游推送维护", "维护下游系统、推送作业及字段。"),
    _permission("code_table:read", "码值表读取", "查询和导出手工码值表。"),
    _permission("code_table:write", "码值表维护", "创建、更新、停用和删除手工码值表。"),
    _permission("field_mapping:read", "字段映射读取", "查询字段映射和映射统计。"),
    _permission("field_mapping:write", "字段映射导入", "批量导入和幂等更新字段映射。"),
    _permission("lineage:read", "血缘读取", "查询血缘 bootstrap、节点和子图。"),
    _permission("metadata:read", "Metadata 读取", "读取 Metadata Ingestion 结果。"),
    _permission(
        "metadata:write", "Metadata 写入", "写入或预览资产、血缘 Metadata ingestion。"
    ),
    _permission("operation_log:read", "操作日志读取", "查询操作日志及日志详情。"),
    _permission("system:user:read", "用户管理读取", "查询系统用户。"),
    _permission(
        "system:user:write", "用户管理维护", "创建、更新、禁用、删除用户及重置密码。"
    ),
    _permission(
        "system:menu:read",
        "菜单管理读取",
        "读取完整菜单管理数据；公共菜单接口仍按公开契约过滤。",
    ),
    _permission(
        "system:menu:write", "菜单管理维护", "创建、更新、排序、停用和删除菜单。"
    ),
    _permission("system:param:read", "参数管理读取", "读取参数分类和参数字典。"),
    _permission(
        "system:param:write", "参数管理维护", "创建、更新、停用和删除参数字典。"
    ),
    _permission("system:role:read", "角色管理读取", "P6 读取角色及权限映射。"),
    _permission("system:role:write", "角色管理维护", "P6 创建、更新角色及权限映射。"),
)

PERMISSION_CODES: tuple[str, ...] = tuple(item.code for item in PERMISSION_DEFINITIONS)
_DEFINITIONS_BY_CODE = MappingProxyType(
    {item.code: item for item in PERMISSION_DEFINITIONS}
)

# The compatibility mapping deliberately remains explicit.  Public reads are
# not made private by this set; the set describes the permissions a maintainer
# receives whenever a later phase protects that operation.
MAINTAINER_PERMISSION_CODES = frozenset(
    {
        "asset:read",
        "asset:write",
        "root:read",
        "root:write",
        "indicator:read",
        "indicator:write",
        "report:read",
        "report:write",
        "api_asset:read",
        "api_asset:write",
        "upstream:read",
        "upstream:write",
        "push:read",
        "push:write",
        "code_table:read",
        "code_table:write",
        "field_mapping:read",
        "field_mapping:write",
        "lineage:read",
        "metadata:read",
        "metadata:write",
        "operation_log:read",
    }
)

BUILTIN_ROLE_PERMISSION_CODES: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        ADMIN_ROLE: frozenset(PERMISSION_CODES),
        MAINTAINER_ROLE: MAINTAINER_PERMISSION_CODES,
    }
)

_PERMISSION_CODE_PATTERN = re.compile(
    r"^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*:(?:read|write)$"
)


def get_permission_definition(code: str) -> PermissionDefinition | None:
    """Return a registry entry without accepting unregistered permissions."""
    return _DEFINITIONS_BY_CODE.get(code)


def is_registered_permission(code: str) -> bool:
    """Return whether *code* is a current registry entry."""
    return code in _DEFINITIONS_BY_CODE


def validate_permission_registry() -> None:
    """Raise ``ValueError`` when the checked-in contract is internally invalid."""
    if not PERMISSION_DEFINITIONS:
        raise ValueError("permission registry must not be empty")
    if len(PERMISSION_CODES) != len(set(PERMISSION_CODES)):
        raise ValueError("permission codes must be unique")
    for item in PERMISSION_DEFINITIONS:
        if not _PERMISSION_CODE_PATTERN.fullmatch(item.code):
            raise ValueError(f"invalid permission code: {item.code}")
        if item.code != f"{item.resource}:{item.action}":
            raise ValueError(f"permission fields do not match code: {item.code}")
        if not item.name.strip() or not item.description.strip():
            raise ValueError(f"permission metadata is incomplete: {item.code}")
    for role, permissions in BUILTIN_ROLE_PERMISSION_CODES.items():
        if not role.strip():
            raise ValueError("builtin role code must be non-empty")
        unknown = set(permissions) - set(PERMISSION_CODES)
        if unknown:
            raise ValueError(
                f"{role} maps unknown permissions: {', '.join(sorted(unknown))}"
            )
    if BUILTIN_ROLE_PERMISSION_CODES[ADMIN_ROLE] != frozenset(PERMISSION_CODES):
        raise ValueError("admin must explicitly map every registered permission")
