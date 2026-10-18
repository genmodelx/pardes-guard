import styles from "./Skeleton.module.css";

/** Grey bars in the shape of the content that is loading. Use instead of a spinner. */
export function Skeleton({ lines = 3, block = false, label }: { lines?: number; block?: boolean; label: string }) {
  return (
    <div className={styles.wrap} role="status" aria-label={label}>
      {block ? <div className={styles.block} /> : null}
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={styles.line} style={{ inlineSize: `${[92, 78, 64, 85, 55][i % 5]}%` }} />
      ))}
    </div>
  );
}
