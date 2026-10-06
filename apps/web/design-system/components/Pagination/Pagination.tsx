import React from "react";
import styles from "./Pagination.module.css";
import { ChevronLeft, ChevronRight } from "../../icons";
import { Button } from "../Button";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className = "",
}: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <nav
      className={`${styles.pagination} ${className}`}
      aria-label="Navegação entre páginas"
    >
      <Button
        variant="secondary"
        size="sm"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Página anterior"
      >
        <ChevronLeft className={styles.icon} />
        Anterior
      </Button>

      <span className={styles.info}>
        Página <strong className="cc-tabular-nums">{currentPage}</strong> de{" "}
        <strong className="cc-tabular-nums">{totalPages}</strong>
      </span>

      <Button
        variant="secondary"
        size="sm"
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="Próxima página"
      >
        Próxima
        <ChevronRight className={styles.icon} />
      </Button>
    </nav>
  );
}
