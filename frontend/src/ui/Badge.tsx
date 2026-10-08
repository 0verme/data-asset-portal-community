import type { ComponentProps, ReactNode } from "react";
import { Badge as KumoBadge } from "@cloudflare/kumo/components/badge";

import { joinClassNames } from "./classNames.ts";
import { BADGE_TONE_MAP, type BadgeTone } from "./variants.ts";

type BadgeBaseProps = {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
};

export type BadgeProps =
  | (BadgeBaseProps & {
      appearance?: "filled";
      icon?: ComponentProps<typeof KumoBadge>["icon"];
    })
  | (BadgeBaseProps & {
      appearance: "dot";
      icon?: never;
      tone?: Exclude<BadgeTone, "brand" | "info">;
    });

export function Badge(props: BadgeProps) {
  const className = joinClassNames("dap-ui-badge", props.className);

  if (props.appearance === "dot") {
    const tone = props.tone ?? "neutral";
    const variant = tone === "neutral" ? "neutral" : BADGE_TONE_MAP[tone];
    return <KumoBadge appearance="dot" className={className} variant={variant}>{props.children}</KumoBadge>;
  }

  const tone = props.tone ?? "neutral";
  return (
    <KumoBadge
      appearance="filled"
      className={className}
      icon={props.icon}
      variant={BADGE_TONE_MAP[tone]}
    >
      {props.children}
    </KumoBadge>
  );
}

export type StatusTone = Exclude<BadgeTone, "brand" | "info">;

export interface StatusProps {
  children: ReactNode;
  className?: string;
  tone: StatusTone;
}

export function Status({ children, className, tone }: StatusProps) {
  return <Badge appearance="dot" tone={tone} {...(className !== undefined ? { className } : {})}>{children}</Badge>;
}
