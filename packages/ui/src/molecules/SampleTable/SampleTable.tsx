import styles from './SampleTable.module.css';

/** Props for SampleTable. */
export interface SampleTableProps {
  /** What the picture says, for screen readers ("The first row holds the column names"). */
  readonly label: string;
  /** The first row is the header, drawn tinted; the rest are sample rows. Every row has the same cells. */
  readonly rows: readonly (readonly string[])[];
  /** A few words under the picture, in the quiet colour ("Row 1: column names"). */
  readonly caption?: string;
}

/**
 * A picture of a small table: a tinted header row over a few sample rows. It teaches a file's shape without a
 * sentence (a CSV's first row holds the column names). It is not interactive and takes no focus.
 */
export function SampleTable({ label, rows, caption }: SampleTableProps) {
  const [header, ...body] = rows;
  return (
    <figure className={styles.root}>
      <div className={styles.frame} role="img" aria-label={label}>
        {/* Sample cells are decoration; the label above says what the picture shows. */}
        <div className={styles.row} data-header="" aria-hidden="true">
          {header?.map((cell, column) => (
            <span key={column} className={styles.cell} data-header="">
              {cell}
            </span>
          ))}
        </div>
        {body.map((row, at) => (
          <div key={at} className={styles.row} aria-hidden="true">
            {row.map((cell, column) => (
              <span key={column} className={styles.cell}>
                {cell}
              </span>
            ))}
          </div>
        ))}
      </div>
      {caption !== undefined && <figcaption className={styles.caption}>{caption}</figcaption>}
    </figure>
  );
}
