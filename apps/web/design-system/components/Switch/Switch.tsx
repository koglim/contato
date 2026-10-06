"use client";

import React from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import styles from "./Switch.module.css";

export interface SwitchProps {
  id?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}

export function Switch({
  id,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled = false,
  required = false,
  label,
  description,
  className = "",
}: SwitchProps) {
  const switchId = id || React.useId();

  return (
    <div className={`${styles.wrapper} ${disabled ? styles.disabled : ""} ${className}`}>
      <div className={styles.targetContainer}>
        <RadixSwitch.Root
          id={switchId}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          required={required}
          className={styles.root}
        >
          <RadixSwitch.Thumb className={styles.thumb} />
        </RadixSwitch.Root>
      </div>

      {label ? (
        <div className={styles.labelContainer}>
          <label htmlFor={switchId} className={styles.label}>
            {label}
          </label>
          {description ? <span className={styles.description}>{description}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
