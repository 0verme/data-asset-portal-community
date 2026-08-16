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

from flask import Blueprint, current_app, jsonify

from ..services.portal_service import portal_service


portal_bp = Blueprint("portal", __name__)


@portal_bp.get("/stats")
def get_portal_stats():
    # 容错边界放到路由层：单项失败已在 service 内降级为 0；这里再兜住容错范围之外的
    # 异常（profile 解析失败、配置错误、连接阶段崩溃等），保证 /api/portal/stats
    # 永远返回 200、门户首页永远能加载。
    try:
        items = portal_service.get_stats()
    except Exception:
        current_app.logger.exception("portal stats fatal; returning zero-filled fallback")
        items = portal_service.zero_stats()
    return jsonify({"items": items})
