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
import { ErrorState } from "./StateCards.jsx";

class ModuleErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("Module render failed:", error);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    const { title, desc, onRetry, children } = this.props;
    if (error) {
      return (
        <ErrorState
          title={title || "模块渲染失败"}
          desc={error?.message || desc || "页面渲染时发生异常，请稍后重试。"}
          onRetry={onRetry}
        />
      );
    }
    return children;
  }
}

export function ModuleErrorBoundary(props) {
  return <ModuleErrorBoundaryInner {...props} />;
}
