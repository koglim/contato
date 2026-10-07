"use client";

import React from "react";
import * as RadixAvatar from "@radix-ui/react-avatar";
import styles from "./Avatar.module.css";

export interface AvatarProps {
  src?: string;
  alt?: string;
  initials?: string;
  size?: "24" | "32" | "40" | "48" | "64";
  className?: string;
}

export function Avatar({
  src,
  alt = "",
  initials = "CC",
  size = "40",
  className = "",
}: AvatarProps) {
  return (
    <RadixAvatar.Root
      className={`${styles.root} ${styles[`size-${size}`]} ${className}`}
      aria-hidden={!alt ? "true" : undefined}
    >
      {src ? (
        <RadixAvatar.Image src={src} alt={alt} className={styles.image} />
      ) : null}
      <RadixAvatar.Fallback className={styles.fallback} delayMs={100} aria-hidden="true">
        {initials.slice(0, 2).toUpperCase()}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
