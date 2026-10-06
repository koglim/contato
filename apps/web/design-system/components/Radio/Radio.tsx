"use client";

import React from "react";
import * as RadixRadioGroup from "@radix-ui/react-radio-group";
import styles from "./Radio.module.css";

export interface RadioOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: RadioOption[];
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  className?: string;
}

export function RadioGroup({
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  disabled = false,
  required = false,
  ariaLabel,
  className = "",
}: RadioGroupProps) {
  return (
    <RadixRadioGroup.Root
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      className={`${styles.group} ${className}`}
    >
      {options.map((opt) => {
        const id = `radio-${name || "opt"}-${opt.value}`;
        const isOptDisabled = disabled || opt.disabled;

        return (
          <div key={opt.value} className={`${styles.itemWrapper} ${isOptDisabled ? styles.disabled : ""}`}>
            <div className={styles.targetContainer}>
              <RadixRadioGroup.Item
                id={id}
                value={opt.value}
                disabled={isOptDisabled}
                className={styles.item}
              >
                <RadixRadioGroup.Indicator className={styles.indicator} />
              </RadixRadioGroup.Item>
            </div>

            <div className={styles.labelContainer}>
              <label htmlFor={id} className={styles.label}>
                {opt.label}
              </label>
              {opt.description ? (
                <span className={styles.description}>{opt.description}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </RadixRadioGroup.Root>
  );
}
