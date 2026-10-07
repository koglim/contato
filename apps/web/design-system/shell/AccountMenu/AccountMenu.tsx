"use client";

import React from "react";
import styles from "./AccountMenu.module.css";
import { Avatar } from "../../components/Avatar";
import { DropdownMenu, DropdownMenuItem } from "../../components/DropdownMenu";
import { ChevronDown } from "../../icons";

export interface AccountMenuProps {
  name: string;
  email?: string;
  avatarSrc?: string;
  initials?: string;
  items: DropdownMenuItem[];
  collapsed?: boolean;
  className?: string;
}

export function AccountMenu({
  name,
  email,
  avatarSrc,
  initials,
  items,
  collapsed = false,
  className = "",
}: AccountMenuProps) {
  const trigger = (
    <button
      type="button"
      className={`${styles.trigger} ${collapsed ? styles.triggerCollapsed : ""} ${className}`}
      aria-label={collapsed ? `Menu da conta de ${name}` : undefined}
    >
      <Avatar
        src={avatarSrc}
        initials={initials || name.slice(0, 2)}
        size={collapsed ? "32" : "32"}
      />
      {!collapsed ? (
        <div className={styles.info}>
          <span className={styles.name}>{name}</span>
          {email ? <span className={styles.email}>{email}</span> : null}
        </div>
      ) : null}
      {!collapsed ? (
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      ) : null}
    </button>
  );

  return (
    <DropdownMenu
      trigger={trigger}
      items={items}
      align={collapsed ? "start" : "end"}
      side={collapsed ? "right" : "top"}
      sideOffset={8}
    />
  );
}
