import { ButtonLink } from "@/components/ui";
import type { SessionDateValues } from "./date-range";
import { sessionListHref } from "./session-list-query";
import styles from "./sessions.module.css";

interface SessionPaginationProps {
  readonly values: SessionDateValues;
  readonly page: number;
  readonly returned: number;
  readonly hasMore: boolean;
}

export function SessionPagination({ values, page, returned, hasMore }: SessionPaginationProps) {
  const hasPrevious = page > 1;

  return (
    <nav className={styles.pagination} aria-label="Sessions pagination">
      <p>
        Page <strong>{page}</strong>
        <span aria-hidden="true"> · </span>
        {returned === 1 ? "1 date row shown" : `${returned} date rows shown`}
      </p>
      <div className={styles.paginationActions}>
        {hasPrevious ? (
          <ButtonLink href={sessionListHref(values, page - 1)} size="sm" variant="secondary">
            Previous
          </ButtonLink>
        ) : (
          <span className={styles.disabledPageAction} aria-disabled="true">
            Previous
          </span>
        )}
        {hasMore ? (
          <ButtonLink href={sessionListHref(values, page + 1)} size="sm" variant="secondary">
            Next
          </ButtonLink>
        ) : (
          <span className={styles.disabledPageAction} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
