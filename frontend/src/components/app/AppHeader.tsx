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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { AppearanceSettings } from "../../appearance/AppearanceSettings.tsx";
import type { MenuItem } from "../../data/menus.ts";
import type { UseAuthSessionResult } from "../../hooks/useAuthSession.ts";
import { LanguageSwitcher } from "../../i18n/LanguageSwitcher.tsx";
import { resolveMenuDisplayName } from "../../routing/menuLabels.ts";
import {
  getNavigationPrimaryLimit,
  splitNavigationMenus,
  type NavigationMenuFitMetrics,
} from "../../routing/navigationMenuGrouping.ts";
import type { ModuleId } from "../../routing/types.ts";
import { Button, DropdownMenu, IconButton, Input } from "../../ui/index.ts";
import { AuthBar } from "../AuthControls.tsx";
import { BrandLogo } from "../BrandLogo.tsx";
import { Icon } from "../ui.tsx";
import type { AppModuleContext } from "./appTypes.ts";

export type NavigationMenuStatus = "loading" | "ready" | "error";

type NavigationFitSnapshot = NavigationMenuFitMetrics & { menuKey: string };

export interface AppHeaderProps {
  module: ModuleId;
  isHome: boolean;
  isPortal: boolean;
  hasSidebar: boolean;
  branding: AppModuleContext["branding"];
  visibleNavMenus: readonly MenuItem[];
  navMenuStatus: NavigationMenuStatus;
  catalogDataAccessReady: boolean;
  onRetryLoadMenus: () => void;
  onSelectModule: (code: string) => void;
  onGoHome: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  hamburgerRef: React.RefObject<HTMLButtonElement | null>;
  mobileSearchOpen: boolean;
  onToggleMobileSearch: () => void;
  searchToggleRef: React.RefObject<HTMLButtonElement | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  searchPlaceholder: string;
  onQueryChange: (nextQuery: string) => void;
  onClearQuery: () => void;
  theme: string;
  themeToggleLabel: string;
  onToggleTheme: () => void;
  auth: UseAuthSessionResult["auth"];
  onLogin: () => void;
  onLogout: () => void | Promise<void>;
}

export function AppHeader({
  module,
  isHome,
  isPortal,
  hasSidebar,
  branding,
  visibleNavMenus,
  navMenuStatus,
  catalogDataAccessReady,
  onRetryLoadMenus,
  onSelectModule,
  onGoHome,
  sidebarOpen,
  onToggleSidebar,
  hamburgerRef,
  mobileSearchOpen,
  onToggleMobileSearch,
  searchToggleRef,
  searchInputRef,
  query,
  searchPlaceholder,
  onQueryChange,
  onClearQuery,
  theme,
  themeToggleLabel,
  onToggleTheme,
  auth,
  onLogin,
  onLogout,
}: AppHeaderProps): React.ReactElement {
  const { t: tCommon } = useTranslation("common");
  const { t: tNavigation } = useTranslation("navigation");
  const displayMenuName = (item: MenuItem): string =>
    resolveMenuDisplayName(
      item,
      (key, defaultValue) => tNavigation(key, { defaultValue }),
    );

  const navSlotRef = useRef<HTMLDivElement | null>(null);
  const navMeasureRef = useRef<HTMLElement | null>(null);
  const navActionsRef = useRef<HTMLDivElement | null>(null);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [navigationFitSnapshot, setNavigationFitSnapshot] = useState<NavigationFitSnapshot | null>(null);

  const navigationPrimaryMenuCount = visibleNavMenus.length;
  const navigationMenuKey = JSON.stringify(
    visibleNavMenus.map((item) => [item.code, displayMenuName(item), item.icon]),
  );

  useLayoutEffect(() => {
    const actions = navActionsRef.current;
    const measureNavigation = (): void => {
      const slot = navSlotRef.current;
      const measure = navMeasureRef.current;
      if (isHome && actions) {
        // Reserve matching room on both sides of the centered navigation.
        slot?.parentElement?.style.setProperty("--portal-tools-width", `${actions.getBoundingClientRect().width}px`);
      }
      if (!slot || !measure || getComputedStyle(measure).display === "none") return;
      const availableWidth = slot.getBoundingClientRect().width;
      if (availableWidth <= 0) return;

      const measuredMenuButtons = [...measure.querySelectorAll<HTMLElement>("[data-nav-measure-item]")];
      const measuredMoreTrigger = measure.querySelector<HTMLElement>("[data-nav-measure-more]");
      if (measuredMenuButtons.length !== navigationPrimaryMenuCount || !measuredMoreTrigger) return;

      const style = getComputedStyle(measure);
      const cssPixels = (value: string): number => Number.parseFloat(value) || 0;
      const next: NavigationFitSnapshot = {
        menuKey: navigationMenuKey,
        availableWidth,
        menuWidths: measuredMenuButtons.map((button) => button.getBoundingClientRect().width),
        moreTriggerWidth: measuredMoreTrigger.getBoundingClientRect().width,
        chromeWidth: cssPixels(style.paddingLeft) + cssPixels(style.paddingRight)
          + cssPixels(style.borderLeftWidth) + cssPixels(style.borderRightWidth),
        gap: cssPixels(style.columnGap),
      };

      setNavigationFitSnapshot((current) => {
        const sameWidths = current?.menuWidths.length === next.menuWidths.length
          && current.menuWidths.every((width, index) => {
            const nextWidth = next.menuWidths[index];
            return nextWidth !== undefined && Math.abs(width - nextWidth) < 0.5;
          });
        if (
          current?.menuKey === next.menuKey
          && Math.abs(current.availableWidth - next.availableWidth) < 0.5
          && sameWidths
          && Math.abs(current.moreTriggerWidth - next.moreTriggerWidth) < 0.5
          && Math.abs(current.chromeWidth - next.chromeWidth) < 0.5
          && Math.abs(current.gap - next.gap) < 0.5
        ) {
          return current;
        }
        return next;
      });
    };

    measureNavigation();
    const observer = new ResizeObserver(measureNavigation);
    if (navSlotRef.current) observer.observe(navSlotRef.current);
    if (navMeasureRef.current) observer.observe(navMeasureRef.current);
    if (isHome && actions) observer.observe(actions);
    window.addEventListener("resize", measureNavigation);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measureNavigation);
    };
  }, [isHome, module, navigationMenuKey, navigationPrimaryMenuCount]);

  useEffect(() => {
    setMoreNavOpen(false);
    const hiddenNavigation = window.matchMedia(isPortal ? "(max-width: 768px)" : "(max-width: 959px)");
    const closeWhenHidden = (): void => {
      if (hiddenNavigation.matches) setMoreNavOpen(false);
    };
    hiddenNavigation.addEventListener("change", closeWhenHidden);
    return () => hiddenNavigation.removeEventListener("change", closeWhenHidden);
  }, [isHome, isPortal]);

  const navigationFitMetrics = navigationFitSnapshot?.menuKey === navigationMenuKey
    ? navigationFitSnapshot
    : null;
  const maxPrimaryMenus = navigationFitMetrics
    ? getNavigationPrimaryLimit(visibleNavMenus, navigationFitMetrics)
    : visibleNavMenus.length;
  const { primary: primaryNavMenus, more: moreNavMenus } = useMemo(
    () => splitNavigationMenus(visibleNavMenus, { maxPrimary: maxPrimaryMenus }),
    [maxPrimaryMenus, visibleNavMenus],
  );
  const moreNavActive = moreNavMenus.some((item) => item.code === module);

  return (
    <header className={`topbar${isPortal ? " portal-topbar" : ""}${isHome ? " portal-home-topbar" : ""}`}>
      <div className="topbar-brand">
        {hasSidebar ? (
          <IconButton
            ref={hamburgerRef}
            className="hamburger"
            type="button"
            variant="tertiary"
            size="sm"
            onClick={onToggleSidebar}
            aria-controls="mobile-sidebar"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? tCommon("navigation.close") : tCommon("navigation.open")}
            icon={<Icon name="menu" size={18} />}
          />
        ) : null}

        <button type="button" className="brand" aria-label={branding.site.display_name} onClick={onGoHome}>
          <span className="brand-mark">
            <BrandLogo src={branding.site.logo_url} alt={branding.site.display_name} />
          </span>
          <span className="brand-name">{branding.site.display_name}<small>{tCommon("app.brandTagline")}</small></span>
        </button>
      </div>

      <div className="topbar-nav-slot" ref={navSlotRef}>
        <nav className="mainnav" aria-label={tCommon("navigation.main")}>
          {navMenuStatus === "loading" ? (
            <Button type="button" variant="tertiary" size="sm" disabled className="navigation-message">{tCommon("navigation.loadingMenus")}</Button>
          ) : navMenuStatus === "error" ? (
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              className="navigation-message"
              onClick={onRetryLoadMenus}
            >
              {tCommon("navigation.menuLoadFailed")}
            </Button>
          ) : catalogDataAccessReady && visibleNavMenus.length === 0 ? (
            <span className="navigation-status" role="status">{tCommon("navigation.noMenus")}</span>
          ) : null}
          {primaryNavMenus.map((item) => (
            <Button
              key={item.code}
              type="button"
              variant="tertiary"
              size="sm"
              className={module === item.code ? "active" : ""}
              onClick={() => onSelectModule(item.code)}
            >
              <Icon name={item.icon} size={15} />{displayMenuName(item)}
            </Button>
          ))}
          {moreNavMenus.length ? (
            <div className="more-nav">
              <DropdownMenu open={moreNavOpen} onOpenChange={(open) => setMoreNavOpen(open)}>
                <DropdownMenu.Trigger
                  render={(
                    <Button
                      variant="tertiary"
                      size="sm"
                      className={`more-nav-trigger${moreNavActive ? " active" : ""}${moreNavOpen ? " open" : ""}`}
                      type="button"
                      aria-expanded={moreNavOpen}
                      aria-label={tCommon("navigation.more")}
                      aria-controls="more-nav-menu"
                    />
                  )}
                >
                  {tCommon("navigation.more")}
                  <Icon name="chevron" size={13} />
                </DropdownMenu.Trigger>
                <DropdownMenu.Content
                  id="more-nav-menu"
                  className={isHome ? "more-nav-menu portal-more-nav-menu" : "more-nav-menu"}
                  align="end"
                  side="bottom"
                >
                  {moreNavMenus.map((item) => (
                    <DropdownMenu.Item
                      key={item.code}
                      className="more-nav-menu-item"
                      icon={<Icon name={item.icon} size={15} />}
                      selected={module === item.code}
                      aria-current={module === item.code ? "page" : undefined}
                      onClick={() => {
                        setMoreNavOpen(false);
                        onSelectModule(item.code);
                      }}
                    >
                      {displayMenuName(item)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu>
            </div>
          ) : null}
        </nav>

        <nav ref={navMeasureRef} className="mainnav mainnav-measure" aria-hidden="true" inert>
          {visibleNavMenus.map((item) => (
            <Button
              key={item.code}
              type="button"
              variant="tertiary"
              size="sm"
              className={module === item.code ? "active" : ""}
              data-nav-measure-item={item.code}
            >
              <Icon name={item.icon} size={15} />{displayMenuName(item)}
            </Button>
          ))}
          <div className="more-nav">
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              className="more-nav-trigger active"
              data-nav-measure-more=""
            >
              {tCommon("navigation.more")}<Icon name="chevron" size={13} />
            </Button>
          </div>
        </nav>
      </div>

      <div className="topbar-actions" ref={navActionsRef}>
        {!isPortal ? (
          <button
            ref={searchToggleRef}
            className="mobile-search-toggle"
            type="button"
            onClick={onToggleMobileSearch}
            aria-controls="global-search"
            aria-expanded={mobileSearchOpen}
            aria-label={mobileSearchOpen ? tCommon("search.closeMobile") : tCommon("search.openMobile")}
          >
            <Icon name={mobileSearchOpen ? "close" : "search"} size={17} />
          </button>
        ) : null}
        {!isPortal ? (
          <div id="global-search" className={`search${query ? " has-val" : ""}${mobileSearchOpen ? " mobile-open" : ""}`}>
            <span className="ico-search"><Icon name="search" size={16} /></span>
            <Input
              ref={searchInputRef}
              aria-label={tCommon("search.global")}
              className="search-input"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              className="clear"
              aria-label={tCommon("search.clear")}
              onClick={onClearQuery}
            >
              <Icon name="close" size={13} />
            </Button>
          </div>
        ) : null}

        <LanguageSwitcher />
        <span className="theme-toggle-wrapper" title={themeToggleLabel}>
          <IconButton
            type="button"
            variant="secondary"
            size="sm"
            className="theme-toggle"
            onClick={onToggleTheme}
            aria-label={themeToggleLabel}
            icon={<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />}
          />
        </span>

        <AppearanceSettings />

        <AuthBar
          auth={auth}
          onLogin={onLogin}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}
