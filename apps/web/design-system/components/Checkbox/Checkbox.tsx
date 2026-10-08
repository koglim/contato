"use client";

import React from "react";
import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { Check } from "../../icons";
import styles from "./Checkbox.module.css";

export interface CheckboxProps {
  id?: string;
  name?: string;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: string;
  className?: string;
}

export function Checkbox({
  id,
  name,
  value,
  checked,
  defaultChecked,
  onCheckedChange,
  disabled = false,
  required = false,
  label,
  description,
  error,
  className = "",
}: CheckboxProps) {
  const checkboxId = id || React.useId();

  return (
    <div className={`${styles.wrapper} ${disabled ? styles.disabled : ""} ${className}`}>
      <div className={styles.checkboxContainer}>
        <RadixCheckbox.Root
          id={checkboxId}
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          onCheckedChange={(val) => {
            if (typeof onCheckedChange === "function") {
              onCheckedChange(val === true);
            }
          }}
          disabled={disabled}
          required={required}
          className={`${styles.root} ${error ? styles.errorRoot : ""}`}
        >
          <RadixCheckbox.Indicator className={styles.indicator}>
            <Check className={styles.checkIcon} />
          </RadixCheckbox.Indicator>
        </RadixCheckbox.Root>
      </div>

      {label ? (
        <div className={styles.labelContainer}>
          <label htmlFor={checkboxId} className={styles.label}>
            {label}
          </label>
          {description ? <span className={styles.description}>{description}</span> : null}
          {error ? <span className={styles.errorText} role="alert">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
