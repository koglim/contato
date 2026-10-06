"use client";

import React from "react";
import * as RadixTabs from "@radix-ui/react-tabs";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({
  items,
  defaultValue,
  value,
  onValueChange,
  className = "",
}: TabsProps) {
  const initialValue = defaultValue || items[0]?.id;

  return (
    <RadixTabs.Root
      value={value}
      defaultValue={initialValue}
      onValueChange={onValueChange}
      className={`${styles.root} ${className}`}
    >
      <RadixTabs.List className={styles.list}>
        {items.map((tab) => (
          <RadixTabs.Trigger
            key={tab.id}
            value={tab.id}
            disabled={tab.disabled}
            className={styles.trigger}
          >
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>

      {items.map((tab) => (
        <RadixTabs.Content key={tab.id} value={tab.id} className={styles.content}>
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
