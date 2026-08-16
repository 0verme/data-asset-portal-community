import React from "react";

export function ModuleDisabledPage({ moduleCode, onBackToPortal }) {
  return (
    <div className="state-card" role="status" aria-live="polite">
      <h4>模块未启用</h4>
      <p>
        {moduleCode
          ? `当前实例未启用模块「${moduleCode}」，无法打开该页面。`
          : "当前实例未启用该模块，无法打开该页面。"}
      </p>
      {typeof onBackToPortal === "function" ? (
        <button type="button" className="btn primary" onClick={onBackToPortal}>
          返回门户
        </button>
      ) : null}
    </div>
  );
}
