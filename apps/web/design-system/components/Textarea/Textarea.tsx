import React from "react";
import styles from "./Textarea.module.css";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  id: string;
  helperText?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    id,
    helperText,
    error,
    disabled = false,
    required = false,
    className = "",
    rows = 4,
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

      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className={`${styles.textarea} ${hasError ? styles.error : ""} ${className}`}
        disabled={disabled}
        required={required}
        aria-invalid={hasError ? "true" : undefined}
        aria-describedby={describedBy}
        {...props}
      />

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
