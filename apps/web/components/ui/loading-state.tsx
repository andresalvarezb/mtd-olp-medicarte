import styles from './loading-state.module.css';


interface LoadingContentProps {
  label:
    string;
}


function LoadingContent({
  label,
}: LoadingContentProps) {
  return (
    <div
      className={styles.content}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <strong>
        {label}
      </strong>

      <span
        className={styles.dots}
        aria-hidden="true"
      >
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}


interface TableLoadingRowProps {
  colSpan:
    number;

  label:
    string;
}


export function TableLoadingRow({
  colSpan,
  label,
}: TableLoadingRowProps) {
  return (
    <tr className={styles.row}>
      <td
        colSpan={colSpan}
        className={styles.cell}
      >
        <div className={styles.tableBody}>
          <LoadingContent
            label={label}
          />
        </div>
      </td>
    </tr>
  );
}


interface PanelLoadingStateProps {
  label:
    string;
}


export function PanelLoadingState({
  label,
}: PanelLoadingStateProps) {
  return (
    <div className={styles.panel}>
      <LoadingContent
        label={label}
      />
    </div>
  );
}
