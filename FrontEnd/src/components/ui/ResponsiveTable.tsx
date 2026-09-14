import { isValidElement, useState } from "react";
import type { Key, MouseEvent, ReactNode } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Empty, Grid, Pagination, Spin, Table } from "antd";
import type { TableProps } from "antd";
import type { AnyObject } from "antd/es/_util/type";
import type { ColumnGroupType, ColumnType, ColumnsType } from "antd/es/table";

import { useI18n } from "../../i18n/useI18n";

const { useBreakpoint } = Grid;

export interface MobileCardConfig {
  /** Column shown as the card heading. Defaults to the first column. */
  titleKey?: string;
  /** Column shown beside the heading, typically a status tag. */
  extraKey?: string;
  /** Column shown in the card footer. Defaults to "actions" when present. */
  actionsKey?: string;
  /** Columns left out of the card entirely. */
  hiddenKeys?: string[];
  /** Label for the toggle that reveals `expandable.expandedRowRender`. */
  expandLabel?: ReactNode;
}

export type ResponsiveTableProps<T extends AnyObject> = TableProps<T> & {
  mobileCard?: MobileCardConfig;
};

type CardColumn<T> = ColumnType<T> & { cardKey: string };

function isColumnGroup<T>(
  column: ColumnsType<T>[number],
): column is ColumnGroupType<T> {
  return "children" in column && Array.isArray(column.children);
}

/** Leaf columns in display order, each with the key cards refer to it by. */
function flattenColumns<T>(columns: ColumnsType<T>): CardColumn<T>[] {
  return columns.flatMap((column, index) => {
    if (isColumnGroup(column)) return flattenColumns(column.children);
    if (column.hidden) return [];
    const { dataIndex } = column;
    const cardKey =
      column.key != null
        ? String(column.key)
        : Array.isArray(dataIndex)
          ? (dataIndex as readonly (string | number)[]).join(".")
          : dataIndex != null
            ? String(dataIndex)
            : `column-${index}`;
    return [{ ...column, cardKey }];
  });
}

/** antd types `dataIndex` as a typed path; at runtime it is keys to walk. */
function readValue(record: unknown, dataIndex: unknown) {
  if (dataIndex == null) return undefined;
  const path = (Array.isArray(dataIndex) ? dataIndex : [dataIndex]) as (
    | string
    | number
  )[];
  return path.reduce<unknown>(
    (value, segment) =>
      value == null
        ? undefined
        : (value as Record<string | number, unknown>)[segment],
    record,
  );
}

function renderCell<T>(
  column: CardColumn<T>,
  record: T,
  index: number,
): ReactNode {
  const value = readValue(record, column.dataIndex);
  if (!column.render) return value as ReactNode;
  const rendered = column.render(value, record, index);
  // A render may return rc-table's `{ children, props }` cell descriptor.
  if (
    rendered &&
    typeof rendered === "object" &&
    !isValidElement(rendered) &&
    "children" in rendered
  ) {
    return (rendered as { children?: ReactNode }).children;
  }
  return rendered as ReactNode;
}

/** Placeholder dashes are table filler; a card simply omits the field. */
function isEmptyCell(node: ReactNode) {
  return (
    node === null ||
    node === undefined ||
    node === false ||
    node === "" ||
    node === "-" ||
    node === "—"
  );
}

function getRowKey<T extends AnyObject>(
  record: T,
  index: number,
  rowKey: TableProps<T>["rowKey"],
): Key {
  if (typeof rowKey === "function") return rowKey(record, index);
  const value = record[(rowKey ?? "key") as keyof T];
  return (value as Key | undefined) ?? index;
}

function CardList<T extends AnyObject>({
  mobileCard,
  columns = [],
  dataSource = [],
  rowKey,
  loading,
  pagination,
  locale,
  expandable,
  onRow,
  onChange,
}: ResponsiveTableProps<T>) {
  const { t } = useI18n();
  const [clientPage, setClientPage] = useState(1);
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);

  const cardColumns = flattenColumns(columns);
  const findColumn = (key?: string) =>
    key === undefined
      ? undefined
      : cardColumns.find((column) => column.cardKey === key);
  const titleColumn = findColumn(
    mobileCard?.titleKey ?? cardColumns[0]?.cardKey,
  );
  const extraColumn = findColumn(mobileCard?.extraKey);
  const actionsColumn = findColumn(mobileCard?.actionsKey ?? "actions");
  const hiddenKeys = new Set(mobileCard?.hiddenKeys);
  const fieldColumns = cardColumns.filter(
    (column) =>
      column !== titleColumn &&
      column !== extraColumn &&
      column !== actionsColumn &&
      !hiddenKeys.has(column.cardKey),
  );

  const paging = pagination === false ? null : (pagination ?? {});
  const pageSize = paging?.pageSize ?? 10;
  const current = paging?.current ?? clientPage;
  const total = paging?.total ?? dataSource.length;
  // A server-paged list already holds one page; only slice local data.
  const rows =
    paging && dataSource.length > pageSize
      ? dataSource.slice((current - 1) * pageSize, current * pageSize)
      : dataSource;

  const spinning =
    typeof loading === "object" ? Boolean(loading.spinning) : Boolean(loading);
  const emptyText =
    typeof locale?.emptyText === "function"
      ? locale.emptyText()
      : locale?.emptyText;
  const renderExpanded = expandable?.expandedRowRender;

  return (
    <Spin spinning={spinning}>
      {rows.length === 0 ? (
        <div className="responsive-table-empty">
          {spinning
            ? null
            : (emptyText ?? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />)}
        </div>
      ) : (
        <ul className="responsive-table-cards">
          {rows.map((record, index) => {
            const key = getRowKey(record, index, rowKey);
            const onCardClick = onRow?.(record, index)?.onClick;
            const canExpand =
              Boolean(renderExpanded) &&
              (expandable?.rowExpandable?.(record) ?? true);
            const expanded = canExpand && expandedKeys.includes(key);
            const extra = extraColumn
              ? renderCell(extraColumn, record, index)
              : null;
            const actions = actionsColumn
              ? renderCell(actionsColumn, record, index)
              : null;
            const fields = fieldColumns
              .map((column) => ({
                column,
                value: renderCell(column, record, index),
              }))
              .filter(({ value }) => !isEmptyCell(value));

            return (
              <li
                key={key}
                className={
                  onCardClick
                    ? "responsive-table-card responsive-table-card--clickable"
                    : "responsive-table-card"
                }
                onClick={onCardClick}
                tabIndex={onCardClick ? 0 : undefined}
                onKeyDown={
                  onCardClick
                    ? (event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        onCardClick(
                          event as unknown as MouseEvent<HTMLLIElement>,
                        );
                      }
                    : undefined
                }
              >
                <div className="responsive-table-card__head">
                  <div className="responsive-table-card__title">
                    {titleColumn
                      ? renderCell(titleColumn, record, index)
                      : null}
                  </div>
                  {!isEmptyCell(extra) && (
                    <div className="responsive-table-card__extra">{extra}</div>
                  )}
                </div>

                {fields.length > 0 && (
                  <dl className="responsive-table-card__fields">
                    {fields.map(({ column, value }) => (
                      <div
                        key={column.cardKey}
                        className="responsive-table-card__field"
                      >
                        <dt>
                          {typeof column.title === "function"
                            ? null
                            : column.title}
                        </dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {(canExpand || !isEmptyCell(actions)) && (
                  <div className="responsive-table-card__footer">
                    {canExpand && (
                      <Button
                        type="link"
                        size="small"
                        className="responsive-table-card__toggle"
                        icon={expanded ? <UpOutlined /> : <DownOutlined />}
                        aria-expanded={expanded}
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedKeys((keys) =>
                            expanded
                              ? keys.filter((item) => item !== key)
                              : [...keys, key],
                          );
                        }}
                      >
                        {mobileCard?.expandLabel ??
                          (expanded
                            ? t("table.card.showLess", undefined, "Show less")
                            : t("table.card.showMore", undefined, "Show more"))}
                      </Button>
                    )}
                    {!isEmptyCell(actions) && (
                      <div className="responsive-table-card__actions">
                        {actions}
                      </div>
                    )}
                  </div>
                )}

                {expanded && (
                  // Interacting with the revealed content must not open the row.
                  <div
                    className="responsive-table-card__expanded"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {renderExpanded?.(record, index, 0, true)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {paging && total > pageSize && (
        <Pagination
          className="responsive-table-pagination"
          align="center"
          size="small"
          showLessItems
          current={current}
          pageSize={pageSize}
          total={total}
          onChange={(page, size) => {
            setClientPage(page);
            paging.onChange?.(page, size);
            // Like antd, also report paging through the table's onChange;
            // some pages only listen there.
            onChange?.({ ...paging, current: page, pageSize: size }, {}, [], {
              action: "paginate",
              currentDataSource: [...dataSource],
            });
          }}
        />
      )}
    </Spin>
  );
}

/**
 * An antd Table that becomes a list of cards on phones. Takes the same
 * columns, pagination, expandable and onRow props, so a page opts in by
 * swapping the component and naming which columns head each card.
 */
export default function ResponsiveTable<T extends AnyObject>({
  mobileCard,
  ...tableProps
}: ResponsiveTableProps<T>) {
  const screens = useBreakpoint();
  // `md` stays undefined until the media observer reports; render the table
  // until it does. Row selection has no card equivalent, so it keeps the table.
  const isPhone = screens.md === false && !tableProps.rowSelection;

  if (!isPhone) return <Table<T> {...tableProps} />;
  return <CardList<T> mobileCard={mobileCard} {...tableProps} />;
}
