"use client";

import React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown, Check } from "../../icons";
import styles from "./Select.module.css";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  helperText?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

export function Select({
  label,
  id,
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = "Selecione uma opção",
  helperText,
  error,
  disabled = false,
  required = false,
  className = "",
}: SelectProps) {
  const selectId = id || React.useId();
  const hasError = Boolean(error);

  return (
    <div className={`${styles.wrapper} ${disabled ? styles.disabledWrapper : ""}`}>
      <label htmlFor={selectId} className={styles.label}>
        {label}
        {required ? <span className={styles.required} aria-hidden="true">*</span> : null}
      </label>

      <RadixSelect.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        disabled={disabled}
        required={required}
      >
        <RadixSelect.Trigger
          id={selectId}
          className={`${styles.trigger} ${hasError ? styles.errorTrigger : ""} ${className}`}
          aria-invalid={hasError ? "true" : undefined}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className={styles.icon}>
            <ChevronDown />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content className={styles.content} position="popper" sideOffset={4}>
            <RadixSelect.Viewport className={styles.viewport}>
              {options.map((opt) => (
                <RadixSelect.Item
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                  className={styles.item}
                >
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className={styles.itemIndicator}>
                    <Check className={styles.checkIcon} />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>

      {hasError ? (
        <span className={styles.errorText} role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span className={styles.helperText}>{helperText}</span>
      ) : null}
    </div>
  );
}
