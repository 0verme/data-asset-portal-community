import { useTranslation } from "react-i18next";
import { Button } from "./Button.tsx";
import { Select } from "./Select.tsx";
import "./TablePagination.css";
import {
  DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  resolveTablePageSizeOptions,
  resolveTablePaginationModel,
} from "./tablePagination.ts";

export interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: readonly number[] | undefined;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  loading = false,
  disabled = false,
  ariaLabel,
  className,
}: TablePaginationProps) {
  const { t } = useTranslation("common");
  const model = resolveTablePaginationModel(page, pageSize, total ?? 0);
  const options = resolveTablePageSizeOptions(pageSizeOptions, model.pageSize);
  const controlsDisabled = disabled;
  const rootClassName = ["dap-table-pagination", className].filter(Boolean).join(" ");

  const unit = t("pagination.unit");

  return (
    <nav
      className={rootClassName}
      aria-label={ariaLabel ?? t("pagination.label")}
      aria-busy={loading || undefined}
      data-loading={loading ? "true" : undefined}
    >
      <div className="dap-table-pagination__range" aria-live="polite">
        {loading ? t("navigation.loadingPageCount") : total === null
          ? t("navigation.pageCountUnavailable")
          : t("pagination.range", { first: model.firstItem, last: model.lastItem, total: model.total })}
      </div>
      <div className="dap-table-pagination__controls">
        <label className="dap-table-pagination__size-group">
          <span>{t("pagination.size")}</span>
          <Select<number>
            aria-label={t("pagination.sizeLabel")}
            className="dap-table-pagination__select"
            size="sm"
            items={options.map((size) => ({ label: String(size), value: size }))}
            value={model.pageSize}
            disabled={controlsDisabled}
            onValueChange={(value) => {
              if (value === null || value === model.pageSize || controlsDisabled) return;
              if (model.page !== 1) onPageChange(1);
              onPageSizeChange(value);
            }}
          />
          {unit && <span>{unit}</span>}
        </label>
        <div className="dap-table-pagination__page-controls" role="group" aria-label={t("pagination.pages")}>
          <Button
            className="dap-table-pagination__button"
            size="sm"
            variant="secondary"
            type="button"
            disabled={controlsDisabled || model.total === 0 || model.page <= 1}
            onClick={() => onPageChange(Math.max(1, model.page - 1))}
          >
            {t("pagination.previous")}
          </Button>
          <span className="dap-table-pagination__page-index">
            {!loading && total !== null ? `${model.page} / ${model.pageCount}` : "—"}
          </span>
          <Button
            className="dap-table-pagination__button"
            size="sm"
            variant="secondary"
            type="button"
            disabled={controlsDisabled || model.total === 0 || model.page >= model.pageCount}
            onClick={() => onPageChange(Math.min(model.pageCount, model.page + 1))}
          >
            {t("pagination.next")}
          </Button>
        </div>
      </div>
    </nav>
  );
}
