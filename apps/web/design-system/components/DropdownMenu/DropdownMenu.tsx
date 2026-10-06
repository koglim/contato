"use client";

import React from "react";
import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import styles from "./DropdownMenu.module.css";

export interface DropdownMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export interface DropdownMenuProps {
  trigger: React.ReactNode;
  items: DropdownMenuItem[];
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

export function DropdownMenu({
  trigger,
  items,
  align = "end",
  side = "bottom",
  sideOffset = 4,
}: DropdownMenuProps) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>
        {trigger}
      </RadixDropdown.Trigger>

      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={styles.content}
        >
          {items.map((item) => (
            <RadixDropdown.Item
              key={item.id}
              disabled={item.disabled}
              onSelect={item.onClick}
              className={`${styles.item} ${item.danger ? styles.dangerItem : ""}`}
            >
              {item.icon ? <span className={styles.icon}>{item.icon}</span> : null}
              <span className={styles.label}>{item.label}</span>
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
