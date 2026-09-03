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

import React, { type ReactNode } from "react";

import { ErrorState } from "./StateCards.tsx";

export interface ModuleErrorBoundaryProps {
  title?: string | undefined;
  desc?: string | undefined;
  onRetry?: (() => void) | undefined;
  resetKey?: unknown;
  children?: ReactNode;
}

interface ModuleErrorBoundaryState {
  error: Error | null;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class ModuleErrorBoundaryInner extends React.Component<ModuleErrorBoundaryProps, ModuleErrorBoundaryState> {
  constructor(props: ModuleErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): ModuleErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: Error): void {
    console.error("Module render failed:", error);
  }

  componentDidUpdate(prevProps: ModuleErrorBoundaryProps): void {
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
          desc={error.message || desc || "页面渲染时发生异常，请稍后重试。"}
          onRetry={onRetry}
        />
      );
    }
    return children;
  }
}

export function ModuleErrorBoundary(props: ModuleErrorBoundaryProps) {
  return <ModuleErrorBoundaryInner {...props} />;
}
