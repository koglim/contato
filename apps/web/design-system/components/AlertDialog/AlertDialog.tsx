"use client";

import React from "react";
import * as RadixAlertDialog from "@radix-ui/react-alert-dialog";
import styles from "./AlertDialog.module.css";
import { Button } from "../Button";

export interface AlertDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  variant?: "danger" | "primary";
}

export function AlertDialog({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  variant = "danger",
}: AlertDialogProps) {
  return (
    <RadixAlertDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? (
        <RadixAlertDialog.Trigger asChild>{trigger}</RadixAlertDialog.Trigger>
      ) : null}

      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={styles.overlay} />
        <RadixAlertDialog.Content className={styles.content}>
          <RadixAlertDialog.Title className={styles.title}>{title}</RadixAlertDialog.Title>
          <RadixAlertDialog.Description className={styles.description}>
            {description}
          </RadixAlertDialog.Description>

          <div className={styles.actions}>
            <RadixAlertDialog.Cancel asChild>
              <Button variant="secondary" onClick={onCancel}>
                {cancelLabel}
              </Button>
            </RadixAlertDialog.Cancel>
            <RadixAlertDialog.Action asChild>
              <Button variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </RadixAlertDialog.Action>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
