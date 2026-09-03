export interface MockSystemUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  deptName: string;
  status: string;
  lastLoginAt: string;
  email: string;
  remark: string;
  createdAt: string;
}

type UserSpec = [string, string, string, string, string];

const SPECS: readonly UserSpec[] = [
  ["USR001", "admin", "演示系统管理员", "admin", "平台运营部"],
  ["USR002", "product_demo", "商品数据维护员", "maintainer", "商品运营部"],
  ["USR003", "member_demo", "会员数据维护员", "maintainer", "会员运营部"],
  ["USR004", "trade_demo", "交易数据维护员", "maintainer", "交易运营部"],
  ["USR005", "store_demo", "门店数据维护员", "maintainer", "门店运营部"],
  ["USR006", "supply_demo", "供应链数据维护员", "maintainer", "供应链部"],
  ["USR007", "marketing_demo", "营销数据维护员", "maintainer", "市场营销部"],
  ["USR008", "service_demo", "服务数据维护员", "maintainer", "客户服务部"],
];

export const SYSTEM_USERS: MockSystemUser[] = SPECS.map(
  ([id, username, displayName, role, deptName], index) => ({
    id,
    username,
    displayName,
    role,
    deptName,
    status: index === 7 ? "disabled" : "enabled",
    lastLoginAt:
      index === 7
        ? ""
        : `2026-07-${String(20 - index).padStart(2, "0")} 09:30:00`,
    email: `${username}@demo.invalid`,
    remark: "完全虚构的演示账号，不对应真实人员。",
    createdAt: "2026-01-01 09:00:00",
  }),
);
