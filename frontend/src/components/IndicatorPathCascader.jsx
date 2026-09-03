import React from "react";

import {
  findIndicatorPathNodes,
  findIndicatorPathValuePath,
  formatIndicatorPath,
  getIndicatorDimensionFromPath,
} from "../data/indicatorPathOptions.ts";
import { Icon } from "./ui.tsx";

function buildColumns(options, activeValues) {
  const columns = [];
  let currentOptions = options;
  let level = 0;

  while (currentOptions?.length) {
    columns.push(currentOptions);
    const activeValue = activeValues[level];
    const activeNode = currentOptions.find((item) => item.value === activeValue);
    if (!activeNode?.children?.length) break;
    currentOptions = activeNode.children;
    level += 1;
  }

  return columns;
}

export function IndicatorPathCascader({
  value = "",
  options = [],
  placeholder = "请选择指标路径",
  disabled = false,
  invalid = false,
  loading = false,
  error = "",
  emptyText = "暂无可选路径",
  onChange,
}) {
  const rootRef = React.useRef(null);
  const selectedValuePath = React.useMemo(() => findIndicatorPathValuePath(value, options), [options, value]);
  const [open, setOpen] = React.useState(false);
  const [activeValues, setActiveValues] = React.useState(selectedValuePath);

  React.useEffect(() => {
    setActiveValues(selectedValuePath);
  }, [selectedValuePath]);

  React.useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selectedNodes = React.useMemo(
    () => findIndicatorPathNodes(selectedValuePath, options),
    [options, selectedValuePath],
  );
  const displayValue = value || formatIndicatorPath(selectedValuePath, options);
  const columns = React.useMemo(() => buildColumns(options, open ? activeValues : selectedValuePath), [activeValues, open, options, selectedValuePath]);
  const hasOptions = options.length > 0;

  const emitChange = (nextValuePath) => {
    const nextPath = formatIndicatorPath(nextValuePath, options);
    const nextNodes = findIndicatorPathNodes(nextValuePath, options);
    onChange?.(nextPath, {
      valuePath: nextValuePath,
      nodes: nextNodes,
      rootDimension: getIndicatorDimensionFromPath(nextValuePath, options),
      isLeaf: nextNodes.length > 0 && !nextNodes[nextNodes.length - 1]?.children?.length,
    });
  };

  const handleSelect = (level, option) => {
    const nextValuePath = [...activeValues.slice(0, level), option.value];
    setActiveValues(nextValuePath);

    if (option.children?.length) return;

    emitChange(nextValuePath);
    setOpen(false);
  };

  const handleClear = (event) => {
    event.stopPropagation();
    setActiveValues([]);
    onChange?.("", { valuePath: [], nodes: [], rootDimension: "", isLeaf: false });
    setOpen(false);
  };

  return (
    <div className="indicator-path-cascader" ref={rootRef}>
      <button
        type="button"
        className={`indicator-path-trigger${open ? " open" : ""}${invalid ? " invalid" : ""}`}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span className={`indicator-path-trigger-text${displayValue ? "" : " placeholder"} mono`}>
          {displayValue || placeholder}
        </span>
        <span className="indicator-path-trigger-actions">
          {displayValue ? (
            <span
              className="indicator-path-clear"
              onClick={handleClear}
              role="button"
              tabIndex={-1}
              aria-label="清空指标路径"
            >
              <Icon name="close" size={12} />
            </span>
          ) : null}
          <Icon name="chevron" size={15} />
        </span>
      </button>

      {open ? (
        <div className="indicator-path-panel">
          <div className="indicator-path-panel-head">
            <span>请选择指标路径</span>
            {selectedNodes.length ? <span className="mono">{formatIndicatorPath(selectedValuePath, options)}</span> : null}
          </div>
          {loading ? <div className="indicator-path-panel-empty">正在加载路径配置...</div> : null}
          {!loading && error ? <div className="indicator-path-panel-empty error">{error}</div> : null}
          {!loading && !error && !hasOptions ? <div className="indicator-path-panel-empty">{emptyText}</div> : null}
          {!loading && !error && hasOptions ? (
            <div className="indicator-path-columns">
              {columns.map((columnOptions, level) => (
                <div key={level} className="indicator-path-column">
                  <div className="indicator-path-column-title">第 {level + 1} 级</div>
                  <div className="indicator-path-option-list">
                    {columnOptions.map((option) => {
                      const active = activeValues[level] === option.value;
                      const selected = selectedValuePath[level] === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`indicator-path-option${active ? " active" : ""}${selected ? " selected" : ""}`}
                          onClick={() => handleSelect(level, option)}
                        >
                          <span>{option.label}</span>
                          {option.children?.length ? <Icon name="chevron" size={13} color="var(--ink-3)" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default IndicatorPathCascader;
