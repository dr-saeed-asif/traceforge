import { Button, ButtonLink } from "@/components/ui";
import type { SessionDateValues } from "./date-range";
import styles from "./sessions.module.css";

export function SessionFilter({ values }: Readonly<{ values: SessionDateValues }>) {
  const active = Boolean(values.from || values.to);

  return (
    <form
      className={styles.filter}
      action="/sessions"
      method="get"
      aria-label="Filter sessions by date"
    >
      <div className={styles.dateField}>
        <label htmlFor="sessions-from">From</label>
        <input id="sessions-from" name="from" type="date" defaultValue={values.from} />
      </div>
      <div className={styles.dateField}>
        <label htmlFor="sessions-to">Through</label>
        <input id="sessions-to" name="to" type="date" defaultValue={values.to} />
      </div>
      <div className={styles.filterActions}>
        <Button size="sm" type="submit">
          Apply range
        </Button>
        {active ? (
          <ButtonLink href="/sessions" size="sm" variant="ghost">
            Clear
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}
