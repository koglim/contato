import React from "react";
import styles from "./Table.module.css";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  compact?: boolean;
}

export function Table({ compact = false, className = "", children, ...props }: TableProps) {
  return (
    <div className={styles.tableWrapper}>
      <table className={`${styles.table} ${compact ? styles.compact : ""} ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHead({ className = "", children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={`${styles.head} ${className}`} {...props}>
      {children}
    </thead>
  );
}

export function TableBody({ className = "", children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={`${styles.body} ${className}`} {...props}>
      {children}
    </tbody>
  );
}

export function TableRow({ className = "", children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`${styles.row} ${className}`} {...props}>
      {children}
    </tr>
  );
}

export function TableHeaderCell({ className = "", children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={`${styles.headerCell} ${className}`} scope="col" {...props}>
      {children}
    </th>
  );
}

export function TableCell({ className = "", children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`${styles.cell} ${className}`} {...props}>
      {children}
    </td>
  );
}
