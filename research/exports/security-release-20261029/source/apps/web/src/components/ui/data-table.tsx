import React from "react";
import type { Key, ReactNode } from "react";
import styles from "./ui.module.css";

export interface DataTableColumn<TRow> {
  readonly key: string;
  readonly header: ReactNode;
  readonly cell: (row: TRow) => ReactNode;
  readonly align?: "start" | "center" | "end";
  readonly width?: string;
}

export interface DataTableProps<TRow> {
  readonly caption: string;
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rows: readonly TRow[];
  readonly getRowKey: (row: TRow, index: number) => Key;
  readonly getRowId?: (row: TRow, index: number) => string;
  readonly emptyContent?: ReactNode;
  readonly renderExpandedRow?: (row: TRow) => ReactNode | null;
  readonly onRowClick?: (row: TRow) => void;
}

export function DataTable<TRow>({
  caption,
  columns,
  rows,
  getRowKey,
  getRowId,
  emptyContent,
  renderExpandedRow,
  onRowClick
}: DataTableProps<TRow>) {
  return (
    <div className={styles.tableViewport} tabIndex={0} role="region" aria-label={caption}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.align ? styles[`align-${column.align}`] : undefined}
                style={column.width ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className={styles.tableEmpty} colSpan={columns.length}>
                {emptyContent ?? "No records available."}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <React.Fragment key={getRowKey(row, rowIndex)}>
                <tr
                  id={getRowId?.(row, rowIndex)}
                  onClick={() => onRowClick?.(row)}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.align ? styles[`align-${column.align}`] : undefined}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
                {renderExpandedRow && renderExpandedRow(row) && (
                  <tr>
                    <td colSpan={columns.length}>{renderExpandedRow(row)}</td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
