"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import * as RadixToast from "@radix-ui/react-toast";
import styles from "./Toast.module.css";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "../../icons";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant?: "info" | "success" | "warning" | "danger";
  duration?: number;
}

interface ToastContextValue {
  toast: (item: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((item: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...item, id }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <RadixToast.Provider swipeDirection="right">
        {children}

        {toasts.map((t) => {
          const Icon = {
            info: Info,
            success: CheckCircle2,
            warning: AlertTriangle,
            danger: AlertCircle,
          }[t.variant || "info"];

          return (
            <RadixToast.Root
              key={t.id}
              duration={t.duration || 4500}
              className={`${styles.root} ${styles[`variant-${t.variant || "info"}`]}`}
              onOpenChange={(open) => {
                if (!open) {
                  setToasts((prev) => prev.filter((item) => item.id !== t.id));
                }
              }}
            >
              <Icon className={styles.icon} aria-hidden="true" />
              <div className={styles.content}>
                <RadixToast.Title className={styles.title}>{t.title}</RadixToast.Title>
                {t.description ? (
                  <RadixToast.Description className={styles.description}>
                    {t.description}
                  </RadixToast.Description>
                ) : null}
              </div>
              <RadixToast.Close className={styles.close} aria-label="Fechar notificação">
                <X className={styles.closeIcon} />
              </RadixToast.Close>
            </RadixToast.Root>
          );
        })}

        <RadixToast.Viewport className={styles.viewport} />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
