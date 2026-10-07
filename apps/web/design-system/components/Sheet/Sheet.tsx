"use client";

import React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import styles from "./Sheet.module.css";
import { X } from "../../icons";

export interface SheetProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  side?: "right" | "left" | "bottom";
}

export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  side = "right",
}: SheetProps) {
  return (
    <RadixDialog.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger ? <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger> : null}

      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content className={`${styles.content} ${styles[`side-${side}`]}`}>
          <div className={styles.header}>
            <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className={styles.description}>
                {description}
              </RadixDialog.Description>
            ) : null}
            <RadixDialog.Close className={styles.close} aria-label="Fechar painel lateral">
              <X className={styles.closeIcon} />
            </RadixDialog.Close>
          </div>

          <div className={styles.body}>{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
