import { formatFreq, type PushJobLike } from "./pushUtils.ts";

export type PushJobTableColumnKey =
  | "job"
  | "sourcePath"
  | "targetPath"
  | "frequency"
  | "status"
  | "action";

export interface PushJobTableColumn {
  key: PushJobTableColumnKey;
  label: string;
  mobileLabel: string;
  width?: string | number | undefined;
  align?: string | undefined;
  className?: string | undefined;
}

export const PUSH_JOB_TABLE_COLUMNS: readonly PushJobTableColumn[] = [
  { key: "job", label: "推送作业 / 来源文件名", mobileLabel: "", width: "28%" },
  { key: "sourcePath", label: "湖仓路径", mobileLabel: "湖仓路径" },
  { key: "targetPath", label: "目标路径", mobileLabel: "目标路径" },
  { key: "frequency", label: "推送频率", mobileLabel: "推送频率", width: 140 },
  { key: "status", label: "状态", mobileLabel: "状态", width: 100 },
  {
    key: "action",
    label: "操作",
    mobileLabel: "",
    width: 100,
    align: "right",
    className: "mobile-card-actions",
  },
];

export function formatPushPath(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return !normalized || normalized === "-" ? "—" : normalized;
}

export interface PushJobTableValues {
  job: {
    name: string;
    sourceFileName: string;
    targetFileName: string;
  };
  sourcePath: string;
  targetPath: string;
  frequency: string;
  status: string;
  action: string;
}

export function getPushJobTableValues(
  job: PushJobLike = {},
): PushJobTableValues {
  return {
    job: {
      name: job.cn || "",
      sourceFileName: job.sourceFileName || job.targetFileName || "",
      targetFileName: job.targetFileName || job.sourceFileName || "",
    },
    sourcePath: formatPushPath(job.sourcePath),
    targetPath: formatPushPath(job.targetPath),
    frequency: formatFreq(job),
    status: job.enabled ? "启用" : "禁用",
    action: "编辑",
  };
}
