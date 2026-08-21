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

import os

try:
    from backend.app import create_app
    from backend.app.settings import get_flask_debug, load_runtime_env
except ModuleNotFoundError:  # direct `python run.py` from backend/
    from app import create_app
    from app.settings import get_flask_debug, load_runtime_env


# The bootstrap supplies a complete, SQLite-only child environment. Preserve
# those values even when a user has unrelated repository .env files.
_demo_bootstrap = os.environ.get("COMMUNITY_DEMO_BOOTSTRAP") == "1"
load_runtime_env(overwrite=not _demo_bootstrap)
app = create_app()


if __name__ == "__main__":
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_PORT", "5099")),
        debug=get_flask_debug(),
    )
