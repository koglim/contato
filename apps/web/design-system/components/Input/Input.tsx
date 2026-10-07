import React from "react";
import styles from "./Input.module.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    id,
    helperText,
    error,
    leftIcon,
    rightIcon,
    disabled = false,
    required = false,
    className = "",
    ...props
  },
  ref
) {
  const hasError = Boolean(error);
  const describedBy = hasError ? `${id}-error` : helperText ? `${id}-helper` : undefined;

  return (
    <div className={`${styles.wrapper} ${disabled ? styles.disabledWrapper : ""}`}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required ? <span className={styles.required} aria-hidden="true">*</span> : null}
      </label>

      <div className={`${styles.inputContainer} ${hasError ? styles.errorContainer : ""}`}>
        {leftIcon ? <span className={styles.leftIcon}>{leftIcon}</span> : null}

        <input
          ref={ref}
          id={id}
          className={`${styles.input} ${leftIcon ? styles.hasLeftIcon : ""} ${rightIcon ? styles.hasRightIcon : ""} ${className}`}
          disabled={disabled}
          required={required}
          aria-invalid={hasError ? "true" : undefined}
          aria-describedby={describedBy}
          {...props}
        />

        {rightIcon ? <span className={styles.rightIcon}>{rightIcon}</span> : null}
      </div>

      {hasError ? (
        <span id={`${id}-error`} className={styles.errorText} role="alert">
          {error}
        </span>
      ) : helperText ? (
        <span id={`${id}-helper`} className={styles.helperText}>
          {helperText}
        </span>
      ) : null}
    </div>
  );
});
